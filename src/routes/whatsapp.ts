import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import { pool } from "../db/client";
import type { Variables } from "../types/hono";

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

import { getQRCode } from "../modules/whatsapp/connect";

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
    return c.json({ error: "WhatsApp não configurado" }, 404);
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

  return c.json(result.rows[0]);

});

whatsapp.post("/campaign", authMiddleware, async (c) => {
  const user = c.get("user");

  if (!user) {
    return c.json({ error: "Usuário não autenticado" }, 401);
  }

  const { message, filter } = await c.req.json();

  if (!message) {
    return c.json({ error: "Mensagem é obrigatória" }, 400);
  }

  try {

    // 1️⃣ buscar clientes com filtro
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

    const customers = await pool.query(customersQuery, [
      user.restaurant_id
    ]);

    // 2️⃣ inserir mensagens na fila
    for (const customer of customers.rows) {

      const personalizedMessage = message.replace(
        "{{name}}",
        customer.name || ""
      );

      await pool.query(
        `
        INSERT INTO whatsapp_messages
        (restaurant_id, customer_id, phone, message)
        VALUES ($1, $2, $3, $4)
        `,
        [
          user.restaurant_id,
          customer.id,
          customer.phone,
          personalizedMessage
        ]
      );
    }

    return c.json({
      success: true,
      total: customers.rows.length
    });

  } catch (err: any) {
    console.error("Erro ao criar campanha:", err);

    return c.json({ error: "Erro ao criar campanha" }, 500);
  }
});


export default whatsapp;