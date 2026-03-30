import { Hono } from "hono";

import { authMiddleware } from "../middleware/auth";
import { pool } from "../db/client";
import type { Variables } from "../types/hono";
import { getQRCode } from "../modules/whatsapp/connect";

const whatsapp = new Hono<{ Variables: Variables }>();

whatsapp.post("/connect", authMiddleware, async (c) => {
  const user = c.get("user");
  const { instanceId, token } = await c.req.json();

  const result = await pool.query(
    `
    INSERT INTO whatsapp_instances
    (restaurant_id, zapi_instance_id, zapi_token, status)
    VALUES ($1,$2,$3,'pending')
    RETURNING *
    `,
    [user.restaurant_id, instanceId, token]
  );

  return c.json(result.rows[0]);
});

whatsapp.get("/status", authMiddleware, async (c) => {
  const user = c.get("user");

  const result = await pool.query(
    `
    SELECT *
    FROM whatsapp_instances
    WHERE restaurant_id = $1
    LIMIT 1
    `,
    [user.restaurant_id]
  );

  return c.json(result.rows[0] || null);
});

whatsapp.get("/qr", authMiddleware, async (c) => {
  const user = c.get("user");

  const instance = await pool.query(
    `
    SELECT *
    FROM whatsapp_instances
    WHERE restaurant_id = $1
    LIMIT 1
    `,
    [user.restaurant_id]
  );

  if (!instance.rows.length) {
    return c.json({ error: "WhatsApp nÃ£o configurado" }, 404);
  }

  const data = await getQRCode(
    instance.rows[0].zapi_instance_id,
    instance.rows[0].zapi_token
  );

  return c.json(data);
});

whatsapp.post("/send", authMiddleware, async (c) => {
  const user = c.get("user");
  const { phone, message } = await c.req.json();

  const result = await pool.query(
    `
    INSERT INTO whatsapp_messages
    (restaurant_id, phone, message)
    VALUES ($1,$2,$3)
    RETURNING *
    `,
    [user.restaurant_id, phone, message]
  );

  console.log("[whatsapp.route] mensagem avulsa criada na fila", {
    messageId: result.rows[0]?.id ?? null,
    restaurantId: user.restaurant_id,
    phone,
  });

  return c.json(result.rows[0]);
});

whatsapp.post("/campaign", authMiddleware, async (c) => {
  const user = c.get("user");

  if (!user) {
    return c.json({ error: "UsuÃ¡rio nÃ£o autenticado" }, 401);
  }

  const { message, filter } = await c.req.json();

  if (!message) {
    return c.json({ error: "Mensagem Ã© obrigatÃ³ria" }, 400);
  }

  try {
    console.log("[whatsapp.route] criando campanha manual de mensagens", {
      restaurantId: user.restaurant_id,
      filter: filter ?? null,
    });

    let customersQuery = `
      SELECT DISTINCT c.id, c.name, c.phone
      FROM customers c
      LEFT JOIN feedbacks f ON f.customer_id = c.id
      WHERE c.restaurant_id = $1
    `;

    if (filter === "recent") {
      customersQuery += `
        AND c.created_at >= NOW() - INTERVAL '30 days'
      `;
    }

    if (filter === "detractors") {
      customersQuery += `
        AND f.nps <= 6
      `;
    }

    if (filter === "with_feedback") {
      customersQuery += `
        AND f.comment IS NOT NULL
      `;
    }

    if (filter === "birthdate") {
      customersQuery += `
        AND EXTRACT(DAY FROM c.birth_date) = EXTRACT(DAY FROM NOW())
        AND EXTRACT(MONTH FROM c.birth_date) = EXTRACT(MONTH FROM NOW())
      `;
    }

    const customers = await pool.query(customersQuery, [user.restaurant_id]);

    console.log("[whatsapp.route] clientes encontrados para campanha manual", {
      restaurantId: user.restaurant_id,
      filter: filter ?? null,
      count: customers.rows.length,
    });

    for (const customer of customers.rows) {
      const personalizedMessage = message.replace("{{name}}", customer.name || "");

      const insertResult = await pool.query(
        `
        INSERT INTO whatsapp_messages
        (restaurant_id, customer_id, phone, message)
        VALUES ($1, $2, $3, $4)
        RETURNING id, status
        `,
        [
          user.restaurant_id,
          customer.id,
          customer.phone,
          personalizedMessage,
        ]
      );

      console.log("[whatsapp.route] mensagem de campanha manual criada", {
        messageId: insertResult.rows[0]?.id ?? null,
        restaurantId: user.restaurant_id,
        customerId: customer.id,
        customerName: customer.name,
        phone: customer.phone,
      });
    }

    return c.json({
      success: true,
      total: customers.rows.length,
    });
  } catch (err: any) {
    console.error("Erro ao criar campanha:", err);

    return c.json({ error: "Erro ao criar campanha" }, 500);
  }
});

whatsapp.post("/automation/birthday", authMiddleware, async (c) => {
  const user = c.get("user");

  if (!user) {
    return c.json({ error: "UsuÃ¡rio nÃ£o autenticado" }, 401);
  }

  const { message, active, title } = await c.req.json();

  if (!message || !title) {
    return c.json({ error: "TÃ­tulo e mensagem sÃ£o obrigatÃ³rios" }, 400);
  }

  try {
    await pool.query(
      `
      INSERT INTO whatsapp_automations 
      (restaurant_id, type, title, message, active)
      VALUES ($1, 'birthday', $2, $3, $4)
      ON CONFLICT (restaurant_id, type)
      DO UPDATE SET 
        title = $2,
        message = $3,
        active = $4
      `,
      [user.restaurant_id, title, message, active]
    );

    return c.json({ success: true });
  } catch (err) {
    console.error("Erro ao salvar automaÃ§Ã£o:", err);
    return c.json({ error: "Erro ao salvar automaÃ§Ã£o" }, 500);
  }
});

whatsapp.get("/automation", authMiddleware, async (c) => {
  const user = c.get("user");

  if (!user) {
    return c.json({ error: "UsuÃ¡rio nÃ£o autenticado" }, 401);
  }

  try {
    const result = await pool.query(
      `
      SELECT 
        id,
        type,
        title,
        message,
        active,
        last_sent_at,
        created_at
      FROM whatsapp_automations
      WHERE restaurant_id = $1
      ORDER BY created_at DESC
      `,
      [user.restaurant_id]
    );

    return c.json(result.rows);
  } catch (err) {
    console.error("Erro ao buscar automaÃ§Ãµes:", err);
    return c.json({ error: "Erro ao buscar automaÃ§Ãµes" }, 500);
  }
});

export default whatsapp;
