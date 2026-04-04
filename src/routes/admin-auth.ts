import { createHash, randomBytes } from "crypto";

import bcrypt from "bcrypt";
import { Hono } from "hono";
import jwt from "jsonwebtoken";

import { pool } from "../db/client";
import { adminAuthMiddleware } from "../middleware/admin-auth";
import type { Variables } from "../types/hono";

const adminAuth = new Hono<{ Variables: Variables }>();

function hashRefreshToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function buildAdminToken(payload: Variables["adminUser"]) {
  return jwt.sign(payload, process.env.JWT_SECRET as string, {
    expiresIn: "15m",
  });
}

adminAuth.post("/login", async (c) => {
  try {
    const body = await c.req.json();
    const email = String(body.email ?? "").trim().toLowerCase();
    const password = String(body.password ?? "");

    if (!email || !password) {
      return c.json({ error: "Email e senha sao obrigatorios" }, 400);
    }

    const result = await pool.query(
      `
      SELECT id, name, email, password_hash, active
      FROM admin_users
      WHERE email = $1
      LIMIT 1
      `,
      [email]
    );

    const adminUser = result.rows[0] as
      | {
          id: string;
          name: string;
          email: string;
          password_hash: string;
          active: boolean;
        }
      | undefined;

    if (!adminUser) {
      return c.json({ error: "Usuario admin nao encontrado" }, 401);
    }

    if (!adminUser.active) {
      return c.json({ error: "Usuario admin inativo" }, 403);
    }

    const passwordMatch = await bcrypt.compare(password, adminUser.password_hash);

    if (!passwordMatch) {
      return c.json({ error: "Senha invalida" }, 401);
    }

    const tokenPayload: Variables["adminUser"] = {
      id: adminUser.id,
      email: adminUser.email,
      name: adminUser.name,
      is_admin: true,
    };

    const access_token = buildAdminToken(tokenPayload);
    const refreshToken = randomBytes(64).toString("hex");
    const refreshTokenHash = hashRefreshToken(refreshToken);

    await pool.query(
      `
      INSERT INTO admin_refresh_tokens (admin_user_id, token, expires_at)
      VALUES ($1, $2, NOW() + INTERVAL '7 days')
      `,
      [adminUser.id, refreshTokenHash]
    );

    return c.json({
      access_token,
      refreshToken,
      adminUser: tokenPayload,
    });
  } catch (error) {
    console.error("[adminAuth] erro no login admin", error);
    return c.json({ error: "Erro no login admin" }, 500);
  }
});

adminAuth.post("/refresh", async (c) => {
  try {
    const body = await c.req.json();
    const refreshToken = String(body.refreshToken ?? "");

    if (!refreshToken) {
      return c.json({ error: "Refresh token obrigatorio" }, 400);
    }

    const refreshTokenHash = hashRefreshToken(refreshToken);

    const tokenResult = await pool.query(
      `
      SELECT admin_user_id, token
      FROM admin_refresh_tokens
      WHERE token = $1
        AND expires_at > NOW()
      LIMIT 1
      `,
      [refreshTokenHash]
    );

    if (tokenResult.rows.length === 0) {
      return c.json({ error: "Refresh token invalido ou expirado" }, 401);
    }

    const adminUserId = tokenResult.rows[0].admin_user_id as string;

    const adminResult = await pool.query(
      `
      SELECT id, name, email, active
      FROM admin_users
      WHERE id = $1
      LIMIT 1
      `,
      [adminUserId]
    );

    if (adminResult.rows.length === 0) {
      return c.json({ error: "Usuario admin nao encontrado" }, 404);
    }

    const adminUser = adminResult.rows[0] as {
      id: string;
      name: string;
      email: string;
      active: boolean;
    };

    if (!adminUser.active) {
      return c.json({ error: "Usuario admin inativo" }, 403);
    }

    const newRefreshToken = randomBytes(64).toString("hex");
    const newRefreshTokenHash = hashRefreshToken(newRefreshToken);

    await pool.query(
      `
      UPDATE admin_refresh_tokens
      SET token = $1,
          expires_at = NOW() + INTERVAL '7 days'
      WHERE token = $2
      `,
      [newRefreshTokenHash, tokenResult.rows[0].token]
    );

    const tokenPayload: Variables["adminUser"] = {
      id: adminUser.id,
      email: adminUser.email,
      name: adminUser.name,
      is_admin: true,
    };

    return c.json({
      access_token: buildAdminToken(tokenPayload),
      refreshToken: newRefreshToken,
      adminUser: tokenPayload,
    });
  } catch (error) {
    console.error("[adminAuth] erro ao renovar token admin", error);
    return c.json({ error: "Erro ao renovar token admin" }, 500);
  }
});

adminAuth.post("/logout", async (c) => {
  try {
    const body = await c.req.json();
    const refreshToken = String(body.refreshToken ?? "");

    if (!refreshToken) {
      return c.json({ error: "Refresh token obrigatorio" }, 400);
    }

    await pool.query(
      `
      DELETE FROM admin_refresh_tokens
      WHERE token = $1
      `,
      [hashRefreshToken(refreshToken)]
    );

    return c.json({ message: "Logout admin realizado com sucesso" });
  } catch (error) {
    console.error("[adminAuth] erro ao fazer logout admin", error);
    return c.json({ error: "Erro ao fazer logout admin" }, 500);
  }
});

adminAuth.get("/me", adminAuthMiddleware, async (c) => {
  const adminUser = c.get("adminUser");

  const result = await pool.query(
    `
    SELECT id, name, email, active, created_at
    FROM admin_users
    WHERE id = $1
    LIMIT 1
    `,
    [adminUser.id]
  );

  if (result.rows.length === 0) {
    return c.json({ error: "Usuario admin nao encontrado" }, 404);
  }

  return c.json({
    adminUser: {
      ...result.rows[0],
      is_admin: true,
    },
  });
});

export default adminAuth;
