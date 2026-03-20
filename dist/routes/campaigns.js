"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hono_1 = require("hono");
const client_1 = require("../db/client");
const auth_1 = require("../middleware/auth");
const app = new hono_1.Hono();
app.post("/", auth_1.authMiddleware, async (c) => {
    const body = await c.req.json();
    const restaurant_id = c.get("user").restaurant_id;
    const { title, message, target, days_of_week, custom_filter } = body;
    const result = await client_1.pool.query(`
    INSERT INTO campaigns (
      restaurant_id,
      title,
      message,
      target,
      days_of_week,
      custom_filter,
      active
    )
    VALUES ($1,$2,$3,$4,$5,$6,true)
    RETURNING *
  `, [
        restaurant_id,
        title,
        message,
        target,
        days_of_week,
        custom_filter || null
    ]);
    return c.json(result.rows[0]);
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
exports.default = app;
