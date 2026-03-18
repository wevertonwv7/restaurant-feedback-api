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


export default whatsapp;