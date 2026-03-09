import { Hono } from "hono";
import { pool } from "../db/client";
import { authMiddleware } from "../middleware/auth";
import type { Variables } from "../types/hono";

const me = new Hono<{ Variables: Variables }>();

me.get("/", authMiddleware, async (c) => {
  const user = c.get("user"); // vem do JWT

  // query para pegar o plano do restaurante
  const result = await pool.query(
    `SELECT plan, slug FROM restaurants WHERE id = $1`,
    [user.restaurant_id]
  );

  const restaurant = result.rows[0];


  console.log("Usuário autenticado:", user);
  console.log("Plano do restaurante:", restaurant);

  return c.json({
    user: {
      ...user,
      plan: restaurant?.plan || "basic",// fallback
      restaurant_slug: restaurant?.slug,
      restaurant_id: user.restaurant_id,
      restaurant_name: restaurant.name,
      email: user.email
    }
  });
});

export default me;