import { Hono } from "hono";
import { pool } from "../db/client";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const auth = new Hono();

auth.post("/login", async (c) => {
  try {
    const body = await c.req.json();
    const { email, password } = body;

    if (!email || !password) {
      return c.json({ error: "Email e senha são obrigatórios" }, 400);
    }

    // Busca usuário junto com dados do restaurante
    const result = await pool.query(
      `SELECT 
  u.id, 
  u.email, 
  u.password_hash, 
  u.restaurant_id,
  r.name AS restaurant_name,
  r.slug AS restaurant_slug,
  r.plan AS restaurant_plan
FROM users u
JOIN restaurants r ON r.id = u.restaurant_id
WHERE u.email = $1`,
      [email]
    );
    const user = result.rows[0];

    if (!user) {
      return c.json({ error: "Usuário não encontrado" }, 401);
    }

    // Verifica senha
    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return c.json({ error: "Senha inválida" }, 401);
    }

    // Busca dados do restaurante
    const restaurantResult = await pool.query(
      "SELECT name, slug FROM restaurants WHERE id = $1",
      [user.restaurant_id]
    );
    const restaurant = restaurantResult.rows[0];

    if (!restaurant) {
      return c.json({ error: "Restaurante não encontrado" }, 404);
    }

    // Gera token JWT
    const token = jwt.sign(
      { id: user.id, restaurant_id: user.restaurant_id },
      process.env.JWT_SECRET as string,
      { expiresIn: "7d" }
    );

    // Retorna contrato esperado pelo Lovable
    return c.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        restaurant_name: restaurant.name,
        restaurant_slug: restaurant.slug,
      },
    });
  } catch (error) {
    console.error(error);
    return c.json({ error: "Erro no login" }, 500);
  }
});

export default auth;