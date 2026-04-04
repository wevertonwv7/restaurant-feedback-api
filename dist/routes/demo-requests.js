"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hono_1 = require("hono");
const client_1 = require("../db/client");
const demoRequests = new hono_1.Hono();
function normalizeText(value) {
    if (value === null || value === undefined) {
        return null;
    }
    const normalized = String(value).trim();
    return normalized.length > 0 ? normalized : null;
}
function normalizeWhatsapp(value) {
    const normalized = normalizeText(value);
    if (!normalized) {
        return null;
    }
    return normalized.replace(/\D/g, "");
}
function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
demoRequests.post("/", async (c) => {
    try {
        const body = await c.req.json();
        const name = normalizeText(body.name);
        const email = normalizeText(body.email);
        const whatsapp = normalizeWhatsapp(body.whatsapp);
        const restaurantName = normalizeText(body.restaurant_name);
        const role = normalizeText(body.role);
        const notes = normalizeText(body.notes);
        if (!name || !email || !whatsapp || !restaurantName || !role) {
            return c.json({ error: "Dados obrigatorios faltando" }, 400);
        }
        if (!isValidEmail(email)) {
            return c.json({ error: "Email invalido" }, 400);
        }
        if (whatsapp.length < 10) {
            return c.json({ error: "WhatsApp invalido" }, 400);
        }
        const result = await client_1.pool.query(`
      INSERT INTO demo_requests
      (
        name,
        email,
        whatsapp,
        restaurant_name,
        role,
        notes
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, created_at
      `, [name, email.toLowerCase(), whatsapp, restaurantName, role, notes]);
        console.log("[demoRequests] solicitacao de demonstracao criada", {
            id: result.rows[0]?.id ?? null,
            email: email.toLowerCase(),
            whatsapp,
            restaurantName,
            role,
        });
        return c.json({
            success: true,
            message: "Solicitacao de demonstracao recebida com sucesso.",
        });
    }
    catch (error) {
        console.error("[demoRequests] erro ao criar solicitacao de demonstracao", error);
        return c.json({ error: "Erro ao registrar solicitacao de demonstracao" }, 500);
    }
});
exports.default = demoRequests;
