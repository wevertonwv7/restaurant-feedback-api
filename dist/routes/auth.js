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
const auth = new hono_1.Hono();
function hashRefreshToken(token) {
    return (0, crypto_1.createHash)("sha256").update(token).digest("hex");
}
auth.post("/login", async (c) => {
    try {
        const body = await c.req.json();
        const email = String(body.email ?? "").trim().toLowerCase();
        const password = String(body.password ?? "");
        if (!email || !password) {
            return c.json({ error: "Email e senha sao obrigatorios" }, 400);
        }
        const result = await client_1.pool.query(`SELECT
        u.id,
        u.name,
        u.role,
        u.active,
        u.email,
        u.password_hash,
        u.restaurant_id,
        r.name AS restaurant_name,
        r.slug AS restaurant_slug,
        r.plan AS restaurant_plan
      FROM users u
      JOIN restaurants r ON r.id = u.restaurant_id
      WHERE u.email = $1
      LIMIT 1`, [email]);
        const user = result.rows[0];
        if (!user) {
            return c.json({ error: "Usuario nao encontrado" }, 401);
        }
        if (user.active === false) {
            return c.json({ error: "Usuario inativo" }, 403);
        }
        const passwordMatch = await bcrypt_1.default.compare(password, user.password_hash);
        if (!passwordMatch) {
            return c.json({ error: "Senha invalida" }, 401);
        }
        const access_token = jsonwebtoken_1.default.sign({
            id: user.id,
            restaurant_id: user.restaurant_id,
            name: user.name,
            role: user.role,
        }, process.env.JWT_SECRET, { expiresIn: "15m" });
        const refreshToken = (0, crypto_1.randomBytes)(64).toString("hex");
        const refreshTokenHash = hashRefreshToken(refreshToken);
        await client_1.pool.query(`
      INSERT INTO refresh_tokens (user_id, token, expires_at)
      VALUES ($1, $2, NOW() + INTERVAL '1 days')
      `, [user.id, refreshTokenHash]);
        await client_1.pool.query(`
      UPDATE users
      SET last_login_at = NOW()
      WHERE id = $1
      `, [user.id]);
        return c.json({
            access_token,
            refreshToken,
            user: {
                id: user.id,
                name: user.name,
                role: user.role,
                email: user.email,
                restaurant_name: user.restaurant_name,
                restaurant_slug: user.restaurant_slug,
                restaurant_plan: user.restaurant_plan,
            },
        });
    }
    catch (error) {
        console.error("[auth] erro no login", error);
        return c.json({ error: "Erro no login" }, 500);
    }
});
auth.post("/logout", async (c) => {
    try {
        const body = await c.req.json();
        const refreshToken = String(body.refreshToken ?? "");
        if (!refreshToken) {
            return c.json({ error: "Refresh token obrigatorio" }, 400);
        }
        const refreshTokenHash = hashRefreshToken(refreshToken);
        await client_1.pool.query(`
      DELETE FROM refresh_tokens
      WHERE token = $1 OR token = $2
      `, [refreshTokenHash, refreshToken]);
        return c.json({
            message: "Logout realizado com sucesso",
        });
    }
    catch (error) {
        console.error("[auth] erro no logout", error);
        return c.json({ error: "Erro ao realizar logout" }, 500);
    }
});
auth.post("/refresh", async (c) => {
    try {
        const body = await c.req.json();
        const refreshToken = String(body.refreshToken ?? "");
        if (!refreshToken) {
            return c.json({ error: "Refresh token obrigatorio" }, 400);
        }
        const refreshTokenHash = hashRefreshToken(refreshToken);
        const tokenResult = await client_1.pool.query(`
      SELECT user_id, token
      FROM refresh_tokens
      WHERE (token = $1 OR token = $2)
        AND expires_at > NOW()
      LIMIT 1
      `, [refreshTokenHash, refreshToken]);
        if (tokenResult.rows.length === 0) {
            return c.json({ error: "Refresh token invalido ou expirado" }, 401);
        }
        const userId = tokenResult.rows[0].user_id;
        const result = await client_1.pool.query(`SELECT
        u.id,
        u.name,
        u.role,
        u.active,
        u.email,
        u.restaurant_id,
        r.name AS restaurant_name,
        r.slug AS restaurant_slug,
        r.plan AS restaurant_plan
      FROM users u
      JOIN restaurants r ON r.id = u.restaurant_id
      WHERE u.id = $1
      LIMIT 1`, [userId]);
        if (result.rows.length === 0) {
            return c.json({ error: "Usuario nao encontrado" }, 404);
        }
        const user = result.rows[0];
        if (user.active === false) {
            return c.json({ error: "Usuario inativo" }, 403);
        }
        const newRefreshToken = (0, crypto_1.randomBytes)(64).toString("hex");
        const newRefreshTokenHash = hashRefreshToken(newRefreshToken);
        await client_1.pool.query(`
      UPDATE refresh_tokens
      SET token = $1, expires_at = NOW() + INTERVAL '1 days'
      WHERE token = $2
      `, [newRefreshTokenHash, tokenResult.rows[0].token]);
        const access_token = jsonwebtoken_1.default.sign({
            id: user.id,
            restaurant_id: user.restaurant_id,
            name: user.name,
            role: user.role,
        }, process.env.JWT_SECRET, { expiresIn: "15m" });
        return c.json({
            access_token,
            refreshToken: newRefreshToken,
            user: {
                id: user.id,
                name: user.name,
                role: user.role,
                email: user.email,
                restaurant_name: user.restaurant_name,
                restaurant_slug: user.restaurant_slug,
                restaurant_plan: user.restaurant_plan,
            },
        });
    }
    catch (error) {
        console.error("[auth] erro ao gerar novo token", error);
        return c.json({ error: "Erro ao gerar novo token" }, 500);
    }
});
exports.default = auth;
