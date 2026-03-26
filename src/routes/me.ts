import { Hono } from "hono";
import { pool } from "../db/client";
import { authMiddleware } from "../middleware/auth";
import type { Variables } from "../types/hono";

const me = new Hono<{ Variables: Variables }>();

me.get("/", authMiddleware, async (c) => {
  const user = c.get("user"); // vem do JWT

  // query para pegar o plano do restaurante
  const result = await pool.query(
    `SELECT r.plan, 
    r.slug AS restaurant_slug,
    r.subscription_status,
    r.stripe_subscription_id,
    u.email,
    r.name AS restaurant_name
  FROM restaurants r 
  JOIN users u
  on r.ID = u.restaurant_id
  WHERE r.id = $1`,
    [user.restaurant_id]
  );

  const restaurant = result.rows[0];

  return c.json({
    user: {
      ...user,
      plan: restaurant?.plan || "basic",// fallback
      restaurant_slug: restaurant?.restaurant_slug,
      restaurant_id: user.restaurant_id,
      restaurant_name: restaurant.restaurant_name,
      email: restaurant.email,
      subscription_status: restaurant?.subscription_status || null,
      stripe_subscription_id: restaurant?.stripe_subscription_id || null,
    }
  });
});

export default me;
