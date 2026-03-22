import { Hono } from "hono";
import { pool } from "../db/client";
import { Variables } from "../types/hono";
import { authMiddleware } from "../middleware/auth";

const app = new Hono<{ Variables: Variables }>();

app.post("/", authMiddleware, async (c) => {
  const body = await c.req.json();
  const restaurant_id = c.get("user").restaurant_id;

  const {
    title,
    message,
    target,
    days_of_week,
    custom_filter,
    send_time
  } = body;

  // 🔥 validações
  if (!title || !message || !target || !days_of_week) {
    return c.json({ error: "Campos obrigatórios não informados" }, 400);
  }

  if (!send_time) {
    return c.json({ error: "send_time é obrigatório (ex: 11:30)" }, 400);
  }

  // valida formato HH:mm
  const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
  if (!timeRegex.test(send_time)) {
    return c.json({ error: "send_time deve estar no formato HH:mm" }, 400);
  }

  try {
    const result = await pool.query(`
      INSERT INTO campaigns (
        restaurant_id,
        title,
        message,
        target,
        days_of_week,
        custom_filter,
        send_time,
        active
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,true)
      RETURNING *
    `, [
      restaurant_id,
      title,
      message,
      target,
      days_of_week,
      custom_filter || null,
      send_time
    ]);

    return c.json(result.rows[0]);

  } catch (err) {
    console.error("Erro ao criar campanha:", err);
    return c.json({ error: "Erro ao criar campanha" }, 500);
  }
});

app.get("/", authMiddleware, async (c) => {
  const restaurant_id = c.get("user").restaurant_id;

  const res = await pool.query(`
    SELECT * FROM campaigns
    WHERE restaurant_id = $1
  `, [restaurant_id]);

  return c.json(res.rows);
});

app.put("/:id/toggle", authMiddleware, async (c) => {
  const id = c.req.param("id");

  await pool.query(`
    UPDATE campaigns
    SET active = NOT active
    WHERE id = $1
  `, [id]);

  return c.json({ success: true });
});

export default app;