import { Hono } from "hono";
import { pool } from "../db/client";
import { authMiddleware } from "../middleware/auth";
import type { Variables } from "../types/hono";

const me = new Hono<{ Variables: Variables }>();

me.get("/", authMiddleware, async (c) => {
  const user = c.get("user"); // vem do JWT

  // query para pegar o plano do restaurante
  const result = await pool.query(
    `SELECT plan FROM restaurants WHERE id = $1`,
    [user.restaurant_id]
  );

  const restaurant = result.rows[0];

  return c.json({
    user: {
      ...user,
      plan: restaurant?.plan || "basic" // fallback
    }
  });
});

export default me;