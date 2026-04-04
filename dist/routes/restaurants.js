"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const bcrypt_1 = __importDefault(require("bcrypt"));
const hono_1 = require("hono");
const slugify_1 = __importDefault(require("slugify"));
const client_1 = require("../db/client");
const auth_1 = require("../middleware/auth");
const restaurant = new hono_1.Hono();
const FEEDBACK_FORM_BASE_URL = process.env.FEEDBACK_FORM_BASE_URL || "https://feedbacks-flow-dev.netlify.app/feedback";
function normalizeTableNumber(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    return String(value).trim();
}
function buildFeedbackUrl(slug, tableNumber) {
    const url = new URL(FEEDBACK_FORM_BASE_URL);
    url.searchParams.set("restaurant_slug", slug);
    if (tableNumber) {
        url.searchParams.set("table_number", tableNumber);
    }
    return url.toString();
}
restaurant.get("/:slug", async (c) => {
    const slug = c.req.param("slug");
    const result = await client_1.pool.query(`SELECT name, slug, plan
     FROM restaurants
     WHERE slug = $1`, [slug]);
    const data = result.rows[0];
    if (!data) {
        return c.json({ error: "Restaurante nao encontrado" }, 404);
    }
    return c.json({
        plan: data.plan,
        restaurant_name: data.name,
    });
});
restaurant.post("/register", async (c) => {
    const body = await c.req.json();
    const { name, email, password, google_review_url } = body;
    if (!name || !email || !password) {
        return c.json({ error: "Campos obrigatorios faltando" }, 400);
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
        const restaurantResult = await client.query(`INSERT INTO restaurants (name, slug, plan, google_review_url)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, slug, plan`, [name, slug, null, google_review_url || null]);
        const createdRestaurant = restaurantResult.rows[0];
        console.log("[restaurants.register] restaurante criado", {
            restaurantId: createdRestaurant.id,
            slug: createdRestaurant.slug,
            plan: createdRestaurant.plan,
            email,
        });
        await client.query(`INSERT INTO users (restaurant_id, email, password_hash)
       VALUES ($1, $2, $3)`, [createdRestaurant.id, email, passwordHash]);
        await client.query("COMMIT");
        return c.json({
            message: "Restaurante criado com sucesso",
            restaurant: createdRestaurant,
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
    const { plan } = await c.req.json();
    if (plan === undefined) {
        return c.json({ error: "Dados invalidos" }, 400);
    }
    await client_1.pool.query(`
    UPDATE restaurants
    SET plan = $1
    WHERE id = $2
    `, [plan, user.restaurant_id]);
    return c.json({ message: "Plano atualizado com sucesso" });
});
restaurant.post("/generate-feedback-link", auth_1.authMiddleware, async (c) => {
    const user = c.get("user");
    const body = await c.req.json().catch(() => ({}));
    const tableNumber = normalizeTableNumber(body.table_number);
    const result = await client_1.pool.query(`
    SELECT slug, name
    FROM restaurants
    WHERE id = $1
    LIMIT 1
    `, [user.restaurant_id]);
    const restaurantData = result.rows[0];
    if (!restaurantData) {
        return c.json({ error: "Restaurante nao encontrado" }, 404);
    }
    return c.json({
        restaurant_slug: restaurantData.slug,
        restaurant_name: restaurantData.name,
        table_number: tableNumber,
        type: tableNumber ? "table" : "general",
        feedback_url: buildFeedbackUrl(restaurantData.slug, tableNumber),
    });
});
exports.default = restaurant;
