"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hono_1 = require("hono");
const client_1 = require("../db/client");
const auth_1 = require("../middleware/auth");
const birthdays = new hono_1.Hono();
birthdays.get("/", auth_1.authMiddleware, async (c) => {
    try {
        console.log(c.get("user"));
        const restaurant_id = c.get("user").restaurant_id;
        const result = await client_1.pool.query(`
      SELECT
        id,
        name,
        phone
      FROM customers
      WHERE restaurant_id = $1
      AND EXTRACT(DAY FROM birthdate) = EXTRACT(DAY FROM CURRENT_DATE)
      AND EXTRACT(MONTH FROM birthdate) = EXTRACT(MONTH FROM CURRENT_DATE)
      `, [restaurant_id]);
        return c.json(result.rows);
    }
    catch (error) {
        console.error(error);
        return c.json({ error: "Erro ao buscar aniversariantes do dia" }, 500);
    }
});
exports.default = birthdays;
