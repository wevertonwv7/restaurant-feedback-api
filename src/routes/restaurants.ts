import { Hono } from "hono";
import { pool } from "../db/client";
import bcrypt from "bcrypt";
import slugify from "slugify";

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

restaurant.post("/register", async (c) => {
  const body = await c.req.json();

  const { name, email, password, google_review_url } = body;

  if (!name || !email || !password) {
    return c.json({ error: "Campos obrigatórios faltando" }, 400);
  }

  const client = await pool.connect();

  try {

    await client.query("BEGIN");

    const passwordHash = await bcrypt.hash(password, 10);

    let slug = slugify(name, {
      lower: true,
      strict: true,
    });

    const slugCheck = await client.query(
      "SELECT id FROM restaurants WHERE slug = $1",
      [slug]
    );

    if (slugCheck.rows.length > 0) {
      slug = `${slug}-${Date.now()}`;
    }

    // cria restaurante
    const restaurantResult = await client.query(
      `INSERT INTO restaurants (name, slug, plan, google_review_url)
       VALUES ($1,$2,$3,$4)
       RETURNING id, name, slug`,
      [name, slug, "basic", google_review_url || null]
    );

    const restaurant = restaurantResult.rows[0];

    // cria usuário dono
    await client.query(
      `INSERT INTO users (restaurant_id, email, password_hash)
       VALUES ($1,$2,$3)`,
      [restaurant.id, email, passwordHash]
    );

    await client.query("COMMIT");

    return c.json({
      message: "Restaurante criado com sucesso",
      restaurant,
    });

  } catch (error) {

    await client.query("ROLLBACK");

    console.error(error);

    return c.json(
      { error: "Erro ao criar restaurante" },
      500
    );
  } finally {
    client.release();
  }
});

export default restaurant;