"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const hono_1 = require("hono");
const client_1 = require("../db/client");
const bcrypt_1 = __importDefault(require("bcrypt"));
const slugify_1 = __importDefault(require("slugify"));
const auth_1 = require("../middleware/auth");
const restaurant = new hono_1.Hono();
restaurant.get("/:slug", async (c) => {
    const slug = c.req.param("slug");
    const result = await client_1.pool.query(`SELECT name, slug, plan
     FROM restaurants
     WHERE slug = $1`, [slug]);
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
    const client = await client_1.pool.connect();
    try {
        await client.query("BEGIN");
        const passwordHash = await bcrypt_1.default.hash(password, 10);
        let slug = (0, slugify_1.default)(name, {
            lower: true,
            strict: true,
        });
        const slugCheck = await client.query("SELECT id FROM restaurants WHERE slug = $1", [slug]);
        if (slugCheck.rows.length > 0) {
            slug = `${slug}-${Date.now()}`;
        }
        // cria restaurante
        const restaurantResult = await client.query(`INSERT INTO restaurants (name, slug, plan, google_review_url)
       VALUES ($1,$2,$3,$4)
       RETURNING id, name, slug`, [name, slug, null, google_review_url || null]);
        const restaurant = restaurantResult.rows[0];
        // cria usuário dono
        await client.query(`INSERT INTO users (restaurant_id, email, password_hash)
       VALUES ($1,$2,$3)`, [restaurant.id, email, passwordHash]);
        await client.query("COMMIT");
        return c.json({
            message: "Restaurante criado com sucesso",
            restaurant,
        });
    }
    catch (error) {
        await client.query("ROLLBACK");
        console.error(error);
        return c.json({ error: "Erro ao criar restaurante" }, 500);
    }
    finally {
        client.release();
    }
});
restaurant.post("/update-plan", auth_1.authMiddleware, async (c) => {
    const user = c.get("user");
    const { restaurantId, plan } = await c.req.json();
    if (!restaurantId || !plan) {
        return c.json({ error: "Dados inválidos" }, 400);
    }
    if (restaurantId !== user.restaurant_id) {
        return c.json({ error: "Acesso negado" }, 403);
    }
    if (!["basic", "pro", "premium"].includes(plan)) {
        return c.json({ error: "Plano inválido" }, 400);
    }
    await client_1.pool.query(`
    UPDATE restaurants
    SET plan = $1
    WHERE id = $2
    `, [plan, restaurantId]);
    return c.json({ message: "Plano atualizado com sucesso" });
});
exports.default = restaurant;
