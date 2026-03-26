"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hono_1 = require("hono");
const client_1 = require("../db/client");
const auth_1 = require("../middleware/auth");
const app = new hono_1.Hono();
app.post("/", auth_1.authMiddleware, async (c) => {
    const body = await c.req.json();
    const restaurant_id = c.get("user").restaurant_id;
    const { title, message, target, days_of_week, custom_filter, send_time } = body;
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
        const result = await client_1.pool.query(`
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
    }
    catch (err) {
        console.error("Erro ao criar campanha:", err);
        return c.json({ error: "Erro ao criar campanha" }, 500);
    }
});
app.get("/", auth_1.authMiddleware, async (c) => {
    const restaurant_id = c.get("user").restaurant_id;
    const res = await client_1.pool.query(`
    SELECT * FROM campaigns
    WHERE restaurant_id = $1
  `, [restaurant_id]);
    return c.json(res.rows);
});
app.put("/:id/toggle", auth_1.authMiddleware, async (c) => {
    const id = c.req.param("id");
    await client_1.pool.query(`
    UPDATE campaigns
    SET active = NOT active
    WHERE id = $1
  `, [id]);
    return c.json({ success: true });
});
app.put("/:id", auth_1.authMiddleware, async (c) => {
    const id = c.req.param("id");
    const restaurant_id = c.get("user").restaurant_id;
    const body = await c.req.json();
    const { title, message, target, days_of_week, custom_filter, send_time } = body;
    // 🔥 validações básicas
    if (!title || !message || !target || !days_of_week) {
        return c.json({ error: "Campos obrigatórios não informados" }, 400);
    }
    if (!send_time) {
        return c.json({ error: "send_time é obrigatório" }, 400);
    }
    const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
    if (!timeRegex.test(send_time)) {
        return c.json({ error: "send_time deve estar no formato HH:mm" }, 400);
    }
    try {
        const result = await client_1.pool.query(`
      UPDATE campaigns
      SET
        title = $1,
        message = $2,
        target = $3,
        days_of_week = $4,
        custom_filter = $5,
        send_time = $6
      WHERE id = $7
      AND restaurant_id = $8
      RETURNING *
    `, [
            title,
            message,
            target,
            days_of_week,
            custom_filter || null,
            send_time,
            id,
            restaurant_id
        ]);
        if (result.rows.length === 0) {
            return c.json({ error: "Campanha não encontrada" }, 404);
        }
        return c.json(result.rows[0]);
    }
    catch (err) {
        console.error("Erro ao atualizar campanha:", err);
        return c.json({ error: "Erro ao atualizar campanha" }, 500);
    }
});
exports.default = app;
