import { Hono } from "hono";
import { pool } from "../db/client";
import bcrypt from "bcrypt";
import { createHash, randomBytes } from "crypto";
import jwt from "jsonwebtoken";

const auth = new Hono();

function hashRefreshToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

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
    const access_token = jwt.sign(
      { id: user.id, restaurant_id: user.restaurant_id },
      process.env.JWT_SECRET as string,
      { expiresIn: "15m" }
    );

    const refreshToken = randomBytes(64).toString("hex");
    const refreshTokenHash = hashRefreshToken(refreshToken);
    await pool.query(
    `INSERT INTO refresh_tokens (user_id, token, expires_at)
     VALUES ($1,$2,NOW() + INTERVAL '1 days')`,
  [user.id, refreshTokenHash]);

    // Retorna contrato esperado pelo Lovable
    return c.json({
      access_token,
      refreshToken,
      user: {
        id: user.id,
        email: user.email,
        restaurant_name: restaurant.name,
        restaurant_slug: restaurant.slug,
        restaurant_plan: user.restaurant_plan
      }
      
    });
  } catch (error) {
    console.error(error);
    return c.json({ error: "Erro no login" }, 500);
  }
});

auth.post("/logout", async (c) => {
  try {
    const { refreshToken } = await c.req.json();

    if (!refreshToken) {
      return c.json({ error: "Refresh token obrigatório" }, 400);
    }

    const refreshTokenHash = hashRefreshToken(refreshToken);

    await pool.query(
      `
      DELETE FROM refresh_tokens
      WHERE token = $1 OR token = $2
      `,
      [refreshTokenHash, refreshToken]
    );

    return c.json({
      message: "Logout realizado com sucesso"
    });

  } catch (error) {
    console.error(error);
    return c.json({ error: "Erro ao realizar logout" }, 500);
  }
});

auth.post("/refresh", async (c) => {
  try {
    const { refreshToken } = await c.req.json();

    if (!refreshToken) {
      return c.json({ error: "Refresh token obrigatório" }, 400);
    }

    const refreshTokenHash = hashRefreshToken(refreshToken);

    const tokenResult = await pool.query(
      `
      SELECT user_id, token
      FROM refresh_tokens
      WHERE (token = $1 OR token = $2)
      AND expires_at > NOW()
      `,
      [refreshTokenHash, refreshToken]
    );

    if (tokenResult.rows.length === 0) {
      return c.json({ error: "Refresh token inválido ou expirado" }, 401);
    }

    const userId = tokenResult.rows[0].user_id;

    const result = await pool.query(
      `SELECT 
        u.id,
        u.email,
        u.restaurant_id,
        r.name AS restaurant_name,
        r.slug AS restaurant_slug,
        r.plan AS restaurant_plan
      FROM users u
      JOIN restaurants r ON r.id = u.restaurant_id
      WHERE u.id = $1`,
      [userId]
    );
    

    if (result.rows.length === 0) {
      return c.json({ error: "Usuário não encontrado" }, 404);
    }

    const user = result.rows[0];

    const newRefreshToken = randomBytes(64).toString("hex");
    const newRefreshTokenHash = hashRefreshToken(newRefreshToken);

    await pool.query(
      `
      UPDATE refresh_tokens
      SET token = $1, expires_at = NOW() + INTERVAL '1 days'
      WHERE token = $2
      `,
      [newRefreshTokenHash, tokenResult.rows[0].token]
    );

    const access_token = jwt.sign(
      {
        id: user.id,
        restaurant_id: user.restaurant_id
      },
      process.env.JWT_SECRET!,
      { expiresIn: "15m" }
    );

return new Response(
  JSON.stringify({
    access_token,
    refreshToken: newRefreshToken,
    user: {
      id: user.id,
      email: user.email,
      restaurant_name: user.restaurant_name,
      restaurant_slug: user.restaurant_slug,
      restaurant_plan: user.restaurant_plan
    }
  }),
  {
    headers: {
      "Content-Type": "application/json"
    }
  }
);

  } catch (error) {
    console.error(error);
    return c.json({ error: "Erro ao gerar novo token" }, 500);
  }
});

export default auth;
