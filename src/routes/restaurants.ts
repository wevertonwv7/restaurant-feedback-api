import { Hono } from "hono";
import { pool } from "../db/client";
import bcrypt from "bcrypt";
import slugify from "slugify";
import { authMiddleware } from "../middleware/auth";
import type { Variables } from "../types/hono";

const restaurant = new Hono<{ Variables: Variables }>();
const FEEDBACK_FORM_BASE_URL =
  process.env.FEEDBACK_FORM_BASE_URL || "https://feedbacks-flow-dev.netlify.app/feedback";

function normalizeTableNumber(value: unknown) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  return String(value).trim();
}

function buildFeedbackUrl(slug: string, tableNumber?: string | null) {
  const url = new URL(FEEDBACK_FORM_BASE_URL);

  url.searchParams.set("restaurant_slug", slug);

  if (tableNumber) {
    url.searchParams.set("table_number", tableNumber);
  }

  return url.toString();
}

restaurant.get("/:slug", async (c) => {
  const slug = c.req.param("slug");

  const result = await pool.query(
    `SELECT name, slug, plan
     FROM restaurants
     WHERE slug = $1`,
    [slug]
  );

  const data = result.rows[0];

  if (!data) {
    return c.json({ error: "Restaurante não encontrado" }, 404);
  }

  return c.json({
    plan: data.plan,
    restaurant_name: data.name
  });
});

restaurant.post("/register", async (c) => {
  const body = await c.req.json();

  const { name, email, password, google_review_url } = body;

  if (!name || !email || !password) {
    return c.json({ error: "Campos obrigatórios faltando" }, 400);
  }

  const client = await pool.connect();

  try {

    await client.query("BEGIN");

    const passwordHash = await bcrypt.hash(password, 10);

    let slug = slugify(name, {
      lower: true,
      strict: true,
    });

    const slugCheck = await client.query(
      "SELECT id FROM restaurants WHERE slug = $1",
      [slug]
    );

    if (slugCheck.rows.length > 0) {
      slug = `${slug}-${Date.now()}`;
    }

    // cria restaurante
    const restaurantResult = await client.query(
      `INSERT INTO restaurants (name, slug, plan, google_review_url)
       VALUES ($1,$2,$3,$4)
       RETURNING id, name, slug, plan`,
      [name, slug, null, google_review_url || null]
    );

    const restaurant = restaurantResult.rows[0];

    console.log("[restaurants.register] restaurante criado", {
      restaurantId: restaurant.id,
      slug: restaurant.slug,
      plan: restaurant.plan,
      email,
    });

    // cria usuário dono
    await client.query(
      `INSERT INTO users (restaurant_id, email, password_hash)
       VALUES ($1,$2,$3)`,
      [restaurant.id, email, passwordHash]
    );

    await client.query("COMMIT");

    return c.json({
      message: "Restaurante criado com sucesso",
      restaurant,
    });

  } catch (error) {

    await client.query("ROLLBACK");

    console.error(error);

    return c.json(
      { error: "Erro ao criar restaurante" },
      500
    );
  } finally {
    client.release();
  }
});

restaurant.post("/update-plan", authMiddleware, async (c) => {
  const user = c.get("user");
  const { plan } = await c.req.json();

  if (!plan) {
    return c.json({ error: "Dados inválidos" }, 400);
  }

  if (!["basic", "pro", "premium"].includes(plan)) {
    return c.json({ error: "Plano inválido" }, 400);
  }

  await pool.query(
    `
    UPDATE restaurants
    SET plan = $1
    WHERE id = $2
    `,
    [plan, user.restaurant_id]
  );

  return c.json({ message: "Plano atualizado com sucesso" });
});

restaurant.post("/generate-feedback-link", authMiddleware, async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({}));
  const tableNumber = normalizeTableNumber(body.table_number);

  const result = await pool.query(
    `
    SELECT slug, name
    FROM restaurants
    WHERE id = $1
    LIMIT 1
    `,
    [user.restaurant_id]
  );

  const restaurantData = result.rows[0];

  if (!restaurantData) {
    return c.json({ error: "Restaurante não encontrado" }, 404);
  }

  return c.json({
    restaurant_slug: restaurantData.slug,
    restaurant_name: restaurantData.name,
    table_number: tableNumber,
    type: tableNumber ? "table" : "general",
    feedback_url: buildFeedbackUrl(restaurantData.slug, tableNumber),
  });
});

export default restaurant;
