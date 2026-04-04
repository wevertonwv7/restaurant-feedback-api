"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = require("crypto");
const bcrypt_1 = __importDefault(require("bcrypt"));
const hono_1 = require("hono");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const client_1 = require("../db/client");
const admin_auth_1 = require("../middleware/admin-auth");
const adminAuth = new hono_1.Hono();
function hashRefreshToken(token) {
    return (0, crypto_1.createHash)("sha256").update(token).digest("hex");
}
function buildAdminToken(payload) {
    return jsonwebtoken_1.default.sign(payload, process.env.JWT_SECRET, {
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
        const result = await client_1.pool.query(`
      SELECT id, name, email, password_hash, active
      FROM admin_users
      WHERE email = $1
      LIMIT 1
      `, [email]);
        const adminUser = result.rows[0];
        if (!adminUser) {
            return c.json({ error: "Usuario admin nao encontrado" }, 401);
        }
        if (!adminUser.active) {
            return c.json({ error: "Usuario admin inativo" }, 403);
        }
        const passwordMatch = await bcrypt_1.default.compare(password, adminUser.password_hash);
        if (!passwordMatch) {
            return c.json({ error: "Senha invalida" }, 401);
        }
        const tokenPayload = {
            id: adminUser.id,
            email: adminUser.email,
            name: adminUser.name,
            is_admin: true,
        };
        const access_token = buildAdminToken(tokenPayload);
        const refreshToken = (0, crypto_1.randomBytes)(64).toString("hex");
        const refreshTokenHash = hashRefreshToken(refreshToken);
        await client_1.pool.query(`
      INSERT INTO admin_refresh_tokens (admin_user_id, token, expires_at)
      VALUES ($1, $2, NOW() + INTERVAL '7 days')
      `, [adminUser.id, refreshTokenHash]);
        return c.json({
            access_token,
            refreshToken,
            adminUser: tokenPayload,
        });
    }
    catch (error) {
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
        const tokenResult = await client_1.pool.query(`
      SELECT admin_user_id, token
      FROM admin_refresh_tokens
      WHERE token = $1
        AND expires_at > NOW()
      LIMIT 1
      `, [refreshTokenHash]);
        if (tokenResult.rows.length === 0) {
            return c.json({ error: "Refresh token invalido ou expirado" }, 401);
        }
        const adminUserId = tokenResult.rows[0].admin_user_id;
        const adminResult = await client_1.pool.query(`
      SELECT id, name, email, active
      FROM admin_users
      WHERE id = $1
      LIMIT 1
      `, [adminUserId]);
        if (adminResult.rows.length === 0) {
            return c.json({ error: "Usuario admin nao encontrado" }, 404);
        }
        const adminUser = adminResult.rows[0];
        if (!adminUser.active) {
            return c.json({ error: "Usuario admin inativo" }, 403);
        }
        const newRefreshToken = (0, crypto_1.randomBytes)(64).toString("hex");
        const newRefreshTokenHash = hashRefreshToken(newRefreshToken);
        await client_1.pool.query(`
      UPDATE admin_refresh_tokens
      SET token = $1,
          expires_at = NOW() + INTERVAL '7 days'
      WHERE token = $2
      `, [newRefreshTokenHash, tokenResult.rows[0].token]);
        const tokenPayload = {
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
    }
    catch (error) {
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
        await client_1.pool.query(`
      DELETE FROM admin_refresh_tokens
      WHERE token = $1
      `, [hashRefreshToken(refreshToken)]);
        return c.json({ message: "Logout admin realizado com sucesso" });
    }
    catch (error) {
        console.error("[adminAuth] erro ao fazer logout admin", error);
        return c.json({ error: "Erro ao fazer logout admin" }, 500);
    }
});
adminAuth.get("/me", admin_auth_1.adminAuthMiddleware, async (c) => {
    const adminUser = c.get("adminUser");
    const result = await client_1.pool.query(`
    SELECT id, name, email, active, created_at
    FROM admin_users
    WHERE id = $1
    LIMIT 1
    `, [adminUser.id]);
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
exports.default = adminAuth;
