import bcrypt from "bcrypt";
import { Hono } from "hono";
import slugify from "slugify";

import { pool } from "../db/client";
import { adminAuthMiddleware } from "../middleware/admin-auth";
import { createRestaurantCheckoutSession } from "../modules/stripe/checkout";
import type { Variables } from "../types/hono";

const admin = new Hono<{ Variables: Variables }>();

type DemoRequestStatus =
  | "new"
  | "contacted"
  | "qualified"
  | "proposal_sent"
  | "won"
  | "lost";

const VALID_DEMO_REQUEST_STATUSES = new Set<DemoRequestStatus>([
  "new",
  "contacted",
  "qualified",
  "proposal_sent",
  "won",
  "lost",
]);

const VALID_USER_ROLES = new Set(["owner", "manager", "attendant"]);

admin.use("*", adminAuthMiddleware);

function normalizeText(value: unknown) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalized = String(value).trim();
  return normalized.length > 0 ? normalized : null;
}

function normalizeBoolean(value: unknown, fallback = true) {
  return typeof value === "boolean" ? value : fallback;
}

function normalizePositiveInt(value: unknown, fallback: number) {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.floor(parsed);
}

admin.get("/admin-users", async (c) => {
  const result = await pool.query(
    `
    SELECT id, name, email, active, created_at
    FROM admin_users
    ORDER BY name ASC, email ASC
    `
  );

  return c.json({ items: result.rows });
});

admin.get("/dashboard/overview", async (c) => {
  const [totalsResult, statusResult, recentLeadsResult, monthlyLeadsResult] =
    await Promise.all([
      pool.query(
        `
        SELECT
          (SELECT COUNT(*) FROM restaurants) AS restaurants_count,
          (SELECT COUNT(*) FROM users) AS users_count,
          (SELECT COUNT(*) FROM demo_requests) AS demo_requests_count,
          (SELECT COUNT(*) FROM demo_requests WHERE status = 'new') AS new_demo_requests_count
        `
      ),
      pool.query(
        `
        SELECT status, COUNT(*)::int AS total
        FROM demo_requests
        GROUP BY status
        ORDER BY status
        `
      ),
      pool.query(
        `
        SELECT
          dr.id,
          dr.name,
          dr.email,
          dr.whatsapp,
          dr.restaurant_name,
          dr.role,
          dr.status,
          dr.next_follow_up_at,
          dr.created_at,
          au.name AS assigned_admin_name
        FROM demo_requests dr
        LEFT JOIN admin_users au ON au.id = dr.assigned_admin_user_id
        ORDER BY dr.created_at DESC
        LIMIT 10
        `
      ),
      pool.query(
        `
        SELECT
          TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
          COUNT(*)::int AS total
        FROM demo_requests
        WHERE created_at >= NOW() - INTERVAL '6 months'
        GROUP BY DATE_TRUNC('month', created_at)
        ORDER BY DATE_TRUNC('month', created_at)
        `
      ),
    ]);

  return c.json({
    summary: totalsResult.rows[0],
    leadsByStatus: statusResult.rows,
    recentLeads: recentLeadsResult.rows,
    monthlyLeads: monthlyLeadsResult.rows,
  });
});

admin.get("/restaurants", async (c) => {
  const search = normalizeText(c.req.query("search"));
  const page = normalizePositiveInt(c.req.query("page"), 1);
  const pageSize = normalizePositiveInt(c.req.query("pageSize"), 20);
  const offset = (page - 1) * pageSize;

  const params: Array<string | number> = [];
  let whereClause = "";

  if (search) {
    params.push(`%${search}%`);
    whereClause = `WHERE r.name ILIKE $${params.length} OR r.slug ILIKE $${params.length}`;
  }

  const listQuery = `
    SELECT
      r.id,
      r.name,
      r.slug,
      r.plan,
      r.subscription_status,
      r.created_at,
      COUNT(u.id)::int AS users_count
    FROM restaurants r
    LEFT JOIN users u ON u.restaurant_id = r.id
    ${whereClause}
    GROUP BY r.id
    ORDER BY r.created_at DESC
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}
  `;

  const countQuery = `
    SELECT COUNT(*)::int AS total
    FROM restaurants r
    ${whereClause}
  `;

  const [listResult, countResult] = await Promise.all([
    pool.query(listQuery, [...params, pageSize, offset]),
    pool.query(countQuery, params),
  ]);

  return c.json({
    items: listResult.rows,
    pagination: {
      page,
      pageSize,
      total: countResult.rows[0]?.total ?? 0,
    },
  });
});

admin.post("/restaurants", async (c) => {
  const body = await c.req.json();
  const restaurantName = normalizeText(body.restaurant_name);
  const googleReviewUrl = normalizeText(body.google_review_url);
  const ownerName = normalizeText(body.owner_name);
  const ownerEmail = normalizeText(body.owner_email)?.toLowerCase();
  const ownerPassword = normalizeText(body.owner_password);
  const ownerRole = normalizeText(body.owner_role)?.toLowerCase() ?? "owner";
  const demoRequestId = normalizeText(body.demo_request_id);

  if (!restaurantName || !ownerEmail || !ownerPassword) {
    return c.json({ error: "Dados obrigatorios faltando" }, 400);
  }

  if (!VALID_USER_ROLES.has(ownerRole)) {
    return c.json({ error: "Role de usuario invalida" }, 400);
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    let slug = slugify(restaurantName, {
      lower: true,
      strict: true,
    });

    const slugCheck = await client.query(
      `SELECT id FROM restaurants WHERE slug = $1 LIMIT 1`,
      [slug]
    );

    if (slugCheck.rows.length > 0) {
      slug = `${slug}-${Date.now()}`;
    }

    const restaurantResult = await client.query(
      `
      INSERT INTO restaurants (name, slug, plan, google_review_url)
      VALUES ($1, $2, $3, $4)
      RETURNING id, name, slug, plan, google_review_url, created_at
      `,
      [restaurantName, slug, "pro", googleReviewUrl]
    );

    const restaurant = restaurantResult.rows[0] as {
      id: string;
    };

    const passwordHash = await bcrypt.hash(ownerPassword, 10);

    const userResult = await client.query(
      `
      INSERT INTO users (restaurant_id, name, email, password_hash, role, active)
      VALUES ($1, $2, $3, $4, $5, true)
      RETURNING id, restaurant_id, name, email, role, active, created_at
      `,
      [restaurant.id, ownerName, ownerEmail, passwordHash, ownerRole]
    );

    if (demoRequestId) {
      await client.query(
        `
        UPDATE demo_requests
        SET status = 'won',
            converted_restaurant_id = $1,
            last_contact_at = NOW(),
            updated_at = NOW()
        WHERE id = $2
        `,
        [restaurant.id, demoRequestId]
      );
    }

    await client.query("COMMIT");

    return c.json({
      message: "Restaurante criado com sucesso",
      restaurant: restaurantResult.rows[0],
      ownerUser: userResult.rows[0],
    });
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("[admin] erro ao criar restaurante", error);
    return c.json({ error: "Erro ao criar restaurante" }, 500);
  } finally {
    client.release();
  }
});

admin.get("/restaurants/:restaurantId/users", async (c) => {
  const restaurantId = c.req.param("restaurantId");

  const result = await pool.query(
    `
    SELECT
      id,
      restaurant_id,
      name,
      email,
      role,
      active,
      last_login_at,
      created_at
    FROM users
    WHERE restaurant_id = $1
    ORDER BY created_at DESC
    `,
    [restaurantId]
  );

  return c.json({ items: result.rows });
});

admin.post("/restaurants/:restaurantId/create-checkout-session", async (c) => {
  const restaurantId = c.req.param("restaurantId");

  const ownerResult = await pool.query(
    `
    SELECT id
    FROM users
    WHERE restaurant_id = $1
    ORDER BY
      CASE WHEN role = 'owner' THEN 0 ELSE 1 END,
      created_at ASC
    LIMIT 1
    `,
    [restaurantId]
  );

  if (ownerResult.rows.length === 0) {
    return c.json({ error: "Usuario do restaurante nao encontrado" }, 404);
  }

  const checkoutResult = await createRestaurantCheckoutSession({
    restaurantId,
    userId: ownerResult.rows[0].id as string,
    requestedPlan: "pro",
  });

  if ("error" in checkoutResult) {
    console.error("[admin] erro ao criar checkout session", {
      restaurantId,
      error: checkoutResult.error,
    });

    return c.json({ error: checkoutResult.error }, checkoutResult.status);
  }

  return c.json({
    success: true,
    url: checkoutResult.session.url,
    sessionId: checkoutResult.session.id,
  });
});

admin.post("/restaurants/:restaurantId/users", async (c) => {
  const restaurantId = c.req.param("restaurantId");
  const body = await c.req.json();
  const name = normalizeText(body.name);
  const email = normalizeText(body.email)?.toLowerCase();
  const password = normalizeText(body.password);
  const role = normalizeText(body.role)?.toLowerCase() ?? "manager";
  const active = normalizeBoolean(body.active, true);

  if (!email || !password) {
    return c.json({ error: "Email e senha sao obrigatorios" }, 400);
  }

  if (!VALID_USER_ROLES.has(role)) {
    return c.json({ error: "Role de usuario invalida" }, 400);
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const result = await pool.query(
    `
    INSERT INTO users (restaurant_id, name, email, password_hash, role, active)
    VALUES ($1, $2, $3, $4, $5, $6)
    RETURNING id, restaurant_id, name, email, role, active, created_at
    `,
    [restaurantId, name, email, passwordHash, role, active]
  );

  return c.json({
    message: "Usuario criado com sucesso",
    user: result.rows[0],
  });
});

admin.put("/restaurant-users/:userId", async (c) => {
  const userId = c.req.param("userId");
  const body = await c.req.json();

  const name = normalizeText(body.name);
  const email = normalizeText(body.email)?.toLowerCase();
  const role = normalizeText(body.role)?.toLowerCase();
  const active =
    typeof body.active === "boolean" ? body.active : null;
  const password = normalizeText(body.password);

  if (role && !VALID_USER_ROLES.has(role)) {
    return c.json({ error: "Role de usuario invalida" }, 400);
  }

  const existingResult = await pool.query(
    `
    SELECT id, name, email, role, active
    FROM users
    WHERE id = $1
    LIMIT 1
    `,
    [userId]
  );

  if (existingResult.rows.length === 0) {
    return c.json({ error: "Usuario nao encontrado" }, 404);
  }

  const existingUser = existingResult.rows[0] as {
    name: string | null;
    email: string;
    role: string | null;
    active: boolean | null;
  };

  const passwordHash = password ? await bcrypt.hash(password, 10) : null;

  const result = await pool.query(
    `
    UPDATE users
    SET name = $1,
        email = $2,
        role = $3,
        active = $4,
        password_hash = COALESCE($5, password_hash)
    WHERE id = $6
    RETURNING id, restaurant_id, name, email, role, active, last_login_at, created_at
    `,
    [
      name ?? existingUser.name,
      email ?? existingUser.email,
      role ?? existingUser.role,
      active ?? existingUser.active ?? true,
      passwordHash,
      userId,
    ]
  );

  return c.json({
    message: "Usuario atualizado com sucesso",
    user: result.rows[0],
  });
});

admin.get("/demo-requests", async (c) => {
  const search = normalizeText(c.req.query("search"));
  const status = normalizeText(c.req.query("status"));
  const assignedAdminUserId = normalizeText(c.req.query("assigned_admin_user_id"));
  const page = normalizePositiveInt(c.req.query("page"), 1);
  const pageSize = normalizePositiveInt(c.req.query("pageSize"), 20);
  const offset = (page - 1) * pageSize;

  const conditions: string[] = [];
  const params: Array<string | number> = [];

  if (search) {
    params.push(`%${search}%`);
    conditions.push(
      `(dr.name ILIKE $${params.length}
        OR dr.email ILIKE $${params.length}
        OR dr.whatsapp ILIKE $${params.length}
        OR dr.restaurant_name ILIKE $${params.length})`
    );
  }

  if (status) {
    params.push(status);
    conditions.push(`dr.status = $${params.length}`);
  }

  if (assignedAdminUserId) {
    params.push(assignedAdminUserId);
    conditions.push(`dr.assigned_admin_user_id = $${params.length}`);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const listQuery = `
    SELECT
      dr.id,
      dr.name,
      dr.email,
      dr.whatsapp,
      dr.restaurant_name,
      dr.role,
      dr.notes,
      dr.status,
      dr.priority,
      dr.source,
      dr.crm_notes,
      dr.first_contact_at,
      dr.last_contact_at,
      dr.next_follow_up_at,
      dr.converted_restaurant_id,
      dr.created_at,
      dr.updated_at,
      au.name AS assigned_admin_name,
      au.id AS assigned_admin_user_id
    FROM demo_requests dr
    LEFT JOIN admin_users au ON au.id = dr.assigned_admin_user_id
    ${whereClause}
    ORDER BY dr.created_at DESC
    LIMIT $${params.length + 1}
    OFFSET $${params.length + 2}
  `;

  const countQuery = `
    SELECT COUNT(*)::int AS total
    FROM demo_requests dr
    ${whereClause}
  `;

  const [listResult, countResult] = await Promise.all([
    pool.query(listQuery, [...params, pageSize, offset]),
    pool.query(countQuery, params),
  ]);

  return c.json({
    items: listResult.rows,
    pagination: {
      page,
      pageSize,
      total: countResult.rows[0]?.total ?? 0,
    },
  });
});

admin.get("/demo-requests/:id", async (c) => {
  const id = c.req.param("id");

  const [leadResult, interactionsResult] = await Promise.all([
    pool.query(
      `
      SELECT
        dr.*,
        au.name AS assigned_admin_name
      FROM demo_requests dr
      LEFT JOIN admin_users au ON au.id = dr.assigned_admin_user_id
      WHERE dr.id = $1
      LIMIT 1
      `,
      [id]
    ),
    pool.query(
      `
      SELECT
        dri.id,
        dri.demo_request_id,
        dri.interaction_type,
        dri.content,
        dri.created_at,
        au.id AS admin_user_id,
        au.name AS admin_user_name
      FROM demo_request_interactions dri
      LEFT JOIN admin_users au ON au.id = dri.admin_user_id
      WHERE dri.demo_request_id = $1
      ORDER BY dri.created_at DESC
      `,
      [id]
    ),
  ]);

  if (leadResult.rows.length === 0) {
    return c.json({ error: "Lead nao encontrado" }, 404);
  }

  return c.json({
    lead: leadResult.rows[0],
    interactions: interactionsResult.rows,
  });
});

admin.put("/demo-requests/:id", async (c) => {
  const adminUser = c.get("adminUser");
  const id = c.req.param("id");
  const body = await c.req.json();

  const status = normalizeText(body.status);
  const priority = normalizeText(body.priority);
  const crmNotes = normalizeText(body.crm_notes);
  const assignedAdminUserId = normalizeText(body.assigned_admin_user_id);
  const nextFollowUpAt = normalizeText(body.next_follow_up_at);
  const convertedRestaurantId = normalizeText(body.converted_restaurant_id);
  const markContacted = normalizeBoolean(body.mark_contacted, false);

  if (status && !VALID_DEMO_REQUEST_STATUSES.has(status as DemoRequestStatus)) {
    return c.json({ error: "Status do lead invalido" }, 400);
  }

  const existingResult = await pool.query(
    `
    SELECT *
    FROM demo_requests
    WHERE id = $1
    LIMIT 1
    `,
    [id]
  );

  if (existingResult.rows.length === 0) {
    return c.json({ error: "Lead nao encontrado" }, 404);
  }

  const existingLead = existingResult.rows[0] as {
    status: string;
    priority: string | null;
    crm_notes: string | null;
    assigned_admin_user_id: string | null;
    next_follow_up_at: string | null;
    converted_restaurant_id: string | null;
    first_contact_at: string | null;
    last_contact_at: string | null;
  };

  const nowExpression = markContacted ? "NOW()" : "last_contact_at";
  const firstContactExpression =
    markContacted && !existingLead.first_contact_at ? "NOW()" : "first_contact_at";

  const result = await pool.query(
    `
    UPDATE demo_requests
    SET status = $1,
        priority = $2,
        crm_notes = $3,
        assigned_admin_user_id = $4,
        next_follow_up_at = $5,
        converted_restaurant_id = $6,
        first_contact_at = ${firstContactExpression},
        last_contact_at = ${nowExpression},
        updated_at = NOW()
    WHERE id = $7
    RETURNING *
    `,
    [
      status ?? existingLead.status,
      priority ?? existingLead.priority ?? "normal",
      crmNotes ?? existingLead.crm_notes,
      assignedAdminUserId ?? existingLead.assigned_admin_user_id,
      nextFollowUpAt ?? existingLead.next_follow_up_at,
      convertedRestaurantId ?? existingLead.converted_restaurant_id,
      id,
    ]
  );

  if (crmNotes || status || markContacted) {
    await pool.query(
      `
      INSERT INTO demo_request_interactions
      (demo_request_id, admin_user_id, interaction_type, content)
      VALUES ($1, $2, $3, $4)
      `,
      [
        id,
        adminUser.id,
        markContacted ? "status_update" : "note",
        crmNotes ??
          `Lead atualizado para status ${status ?? existingLead.status}`,
      ]
    );
  }

  return c.json({
    message: "Lead atualizado com sucesso",
    lead: result.rows[0],
  });
});

admin.post("/demo-requests/:id/interactions", async (c) => {
  const adminUser = c.get("adminUser");
  const id = c.req.param("id");
  const body = await c.req.json();
  const interactionType = normalizeText(body.interaction_type) ?? "note";
  const content = normalizeText(body.content);

  if (!content) {
    return c.json({ error: "Conteudo da interacao e obrigatorio" }, 400);
  }

  const result = await pool.query(
    `
    INSERT INTO demo_request_interactions
    (demo_request_id, admin_user_id, interaction_type, content)
    VALUES ($1, $2, $3, $4)
    RETURNING id, demo_request_id, admin_user_id, interaction_type, content, created_at
    `,
    [id, adminUser.id, interactionType, content]
  );

  await pool.query(
    `
    UPDATE demo_requests
    SET last_contact_at = NOW(),
        updated_at = NOW()
    WHERE id = $1
    `,
    [id]
  );

  return c.json({
    message: "Interacao registrada com sucesso",
    interaction: result.rows[0],
  });
});

export default admin;
