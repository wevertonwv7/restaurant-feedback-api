"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.birthdayWorker = birthdayWorker;
const client_1 = require("../db/client");
async function birthdayWorker() {
    console.log("🎂 Birthday worker iniciado...");
    setInterval(async () => {
        try {
            console.log("🔄 Verificando aniversariantes...");
            // 1️⃣ buscar automações ativas
            const automations = await client_1.pool.query(`
        SELECT *
        FROM whatsapp_automations
        WHERE type = 'birthday'
        AND active = true
        AND (last_sent_at IS NULL OR last_sent_at < CURRENT_DATE)
      `);
            for (const automation of automations.rows) {
                // 2️⃣ buscar aniversariantes do restaurante
                const customers = await client_1.pool.query(`
          SELECT id, name, phone
          FROM customers
          WHERE restaurant_id = $1
          AND EXTRACT(DAY FROM birth_date) = EXTRACT(DAY FROM NOW())
          AND EXTRACT(MONTH FROM birth_date) = EXTRACT(MONTH FROM NOW())
          `, [automation.restaurant_id]);
                // 3️⃣ criar mensagens na fila
                for (const customer of customers.rows) {
                    const message = automation.message.replace("{{name}}", customer.name || "");
                    await client_1.pool.query(`
            INSERT INTO whatsapp_messages
            (restaurant_id, customer_id, phone, message)
            VALUES ($1, $2, $3, $4)
            `, [
                        automation.restaurant_id,
                        customer.id,
                        customer.phone,
                        message
                    ]);
                }
            }
        }
        catch (err) {
            console.error("❌ Erro no birthday worker:", err);
        }
    }, 1000 * 60 * 60 * 24); // roda a cada 24h
}
