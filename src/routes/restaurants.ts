import { Hono } from "hono";
import { pool } from "../db/client";

const restaurant = new Hono();

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

export default restaurant;