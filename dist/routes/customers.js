"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hono_1 = require("hono");
const client_1 = require("../db/client");
const uuid_1 = require("uuid");
const customers = new hono_1.Hono();
customers.post("/", async (c) => {
    try {
        const body = await c.req.json();
        const { restaurant_slug, name, phone, birth_day, birth_month, consent_lgpd } = body;
        const phoneAtualizado = '55' + phone;
        if (!restaurant_slug || !phone || !consent_lgpd) {
            return c.json({ error: "Dados obrigatórios faltando" }, 400);
        }
        const restaurantResult = await client_1.pool.query(`SELECT id FROM restaurants WHERE slug = $1`, [restaurant_slug]);
        const restaurant = restaurantResult.rows[0];
        if (!restaurant) {
            return c.json({ error: "Restaurante não encontrado" }, 404);
        }
        const restaurant_id = restaurant.id;
        // verifica se já existe
        const customerResult = await client_1.pool.query(`SELECT id FROM customers
       WHERE phone = $1 AND restaurant_id = $2`, [phoneAtualizado, restaurant_id]);
        let customer_id;
        if (customerResult.rows.length > 0) {
            customer_id = customerResult.rows[0].id;
        }
        else {
            const birthdate = birth_day && birth_month
                ? `2000-${birth_month}-${birth_day}`
                : null;
            const newCustomer = await client_1.pool.query(`INSERT INTO customers
         (id, restaurant_id, name, phone, birthdate, consent_lgpd)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id`, [
                (0, uuid_1.v4)(),
                restaurant_id,
                name,
                phoneAtualizado,
                birthdate,
                consent_lgpd
            ]);
            customer_id = newCustomer.rows[0].id;
        }
        return c.json({
            success: true,
            customer_id
        });
    }
    catch (error) {
        console.error(error);
        return c.json({ error: "Erro ao criar cliente" }, 500);
    }
});
exports.default = customers;
