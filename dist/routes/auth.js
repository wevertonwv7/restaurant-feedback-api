"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const hono_1 = require("hono");
const client_1 = require("../db/client");
const bcrypt_1 = __importDefault(require("bcrypt"));
const crypto_1 = require("crypto");
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const auth = new hono_1.Hono();
auth.post("/login", async (c) => {
    try {
        const body = await c.req.json();
        const { email, password } = body;
        if (!email || !password) {
            return c.json({ error: "Email e senha são obrigatórios" }, 400);
        }
        // Busca usuário junto com dados do restaurante
        const result = await client_1.pool.query(`SELECT 
        u.id, 
        u.email, 
        u.password_hash, 
        u.restaurant_id,
        r.name AS restaurant_name,
        r.slug AS restaurant_slug,
        r.plan AS restaurant_plan
      FROM users u
      JOIN restaurants r ON r.id = u.restaurant_id
      WHERE u.email = $1`, [email]);
        const user = result.rows[0];
        if (!user) {
            return c.json({ error: "Usuário não encontrado" }, 401);
        }
        // Verifica senha
        const passwordMatch = await bcrypt_1.default.compare(password, user.password_hash);
        if (!passwordMatch) {
            return c.json({ error: "Senha inválida" }, 401);
        }
        // Busca dados do restaurante
        const restaurantResult = await client_1.pool.query("SELECT name, slug FROM restaurants WHERE id = $1", [user.restaurant_id]);
        const restaurant = restaurantResult.rows[0];
        if (!restaurant) {
            return c.json({ error: "Restaurante não encontrado" }, 404);
        }
        // Gera token JWT
        const access_token = jsonwebtoken_1.default.sign({ id: user.id, restaurant_id: user.restaurant_id }, process.env.JWT_SECRET, { expiresIn: "15m" });
        const refreshToken = (0, crypto_1.randomBytes)(64).toString("hex");
        await client_1.pool.query(`INSERT INTO refresh_tokens (user_id, token, expires_at)
     VALUES ($1,$2,NOW() + INTERVAL '1 days')`, [user.id, refreshToken]);
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
    }
    catch (error) {
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
        await client_1.pool.query(`
      DELETE FROM refresh_tokens
      WHERE token = $1
      `, [refreshToken]);
        return c.json({
            message: "Logout realizado com sucesso"
        });
    }
    catch (error) {
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
        const tokenResult = await client_1.pool.query(`
      SELECT user_id
      FROM refresh_tokens
      WHERE token = $1
      AND expires_at > NOW()
      `, [refreshToken]);
        console.log("Resultado do token:", tokenResult.rows);
        if (tokenResult.rows.length === 0) {
            return c.json({ error: "Refresh token inválido ou expirado" }, 401);
        }
        const userId = tokenResult.rows[0].user_id;
        const result = await client_1.pool.query(`SELECT 
        u.id,
        u.email,
        u.restaurant_id,
        r.name AS restaurant_name,
        r.slug AS restaurant_slug,
        r.plan AS restaurant_plan
      FROM users u
      JOIN restaurants r ON r.id = u.restaurant_id
      WHERE u.id = $1`, [userId]);
        if (result.rows.length === 0) {
            return c.json({ error: "Usuário não encontrado" }, 404);
        }
        const user = result.rows[0];
        const access_token = jsonwebtoken_1.default.sign({
            id: user.id,
            restaurant_id: user.restaurant_id
        }, process.env.JWT_SECRET, { expiresIn: "15m" });
        return new Response(JSON.stringify({
            access_token,
            refreshToken,
            user: {
                id: user.id,
                email: user.email,
                restaurant_name: user.restaurant_name,
                restaurant_slug: user.restaurant_slug,
                restaurant_plan: user.restaurant_plan
            }
        }), {
            headers: {
                "Content-Type": "application/json"
            }
        });
    }
    catch (error) {
        console.error(error);
        return c.json({ error: "Erro ao gerar novo token" }, 500);
    }
});
exports.default = auth;
