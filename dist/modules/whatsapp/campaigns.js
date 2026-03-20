"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processCampaigns = processCampaigns;
const client_1 = require("../../db/client");
function normalizePhone(phone) {
    if (phone.startsWith("55"))
        return phone;
    return "55" + phone;
}
function personalizeMessage(message, customer) {
    return message.replace("{name}", customer.name || "");
}
function isTodayValid(days) {
    const today = new Date().getDay(); // 0 = domingo
    return days.includes(today);
}
async function getCustomers(campaign) {
    const { target, restaurant_id, custom_filter } = campaign;
    if (target === "detractors") {
        const res = await client_1.pool.query(`
      SELECT *
        FROM customers a
        JOIN feedbacks f ON f.customer_id = a.id
        WHERE a.restaurant_id = $1
        AND a.consent_lgpd = true
        AND f.nps <= 3
        AND DATE(f.created_at AT TIME ZONE 'America/Sao_Paulo') = 
            DATE(NOW() AT TIME ZONE 'America/Sao_Paulo') - INTERVAL '1 day'
        AND NOT EXISTS (
            SELECT 1
            FROM whatsapp_messages wm
            WHERE wm.customer_id = a.id
            AND wm.sent_at IS NOT NULL
            AND DATE(wm.sent_at AT TIME ZONE 'America/Sao_Paulo') =
                DATE(NOW() AT TIME ZONE 'America/Sao_Paulo')
        );
    `, [restaurant_id]);
        return res.rows;
    }
    if (target === "birthday") {
        const res = await client_1.pool.query(`
      SELECT *
        FROM customers c
        WHERE c.restaurant_id = $1
        AND c.consent_lgpd = true
        AND EXTRACT(DAY FROM c.birthdate) = EXTRACT(DAY FROM NOW() AT TIME ZONE 'America/Sao_Paulo')
        AND EXTRACT(MONTH FROM c.birthdate) = EXTRACT(MONTH FROM NOW() AT TIME ZONE 'America/Sao_Paulo')
        AND NOT EXISTS (
            SELECT 1
            FROM whatsapp_messages wm
            WHERE wm.customer_id = c.id
            AND DATE(wm.sent_at AT TIME ZONE 'America/Sao_Paulo') =
                DATE(NOW() AT TIME ZONE 'America/Sao_Paulo')
  );

    `, [restaurant_id]);
        return res.rows;
    }
    if (target === "custom") {
        let query = `
      SELECT * FROM customers
      WHERE restaurant_id = $1
      AND consent_lgpd = true
    `;
        const values = [restaurant_id];
        let index = 2;
        if (custom_filter?.min_rating) {
            query += ` AND rating >= $${index}`;
            values.push(custom_filter.min_rating);
            index++;
        }
        if (custom_filter?.max_rating) {
            query += ` AND rating <= $${index}`;
            values.push(custom_filter.max_rating);
            index++;
        }
        const res = await client_1.pool.query(query, values);
        return res.rows;
    }
    return [];
}
async function processCampaigns() {
    const campaigns = await client_1.pool.query(`
    SELECT * FROM campaigns
    WHERE active = true
  `);
    console.log(`🔎 Encontradas ${campaigns.rows.length} campanhas ativas`);
    for (const campaign of campaigns.rows) {
        // evita conflito com birthdayWorker
        // (campaign.target === "birthday") continue;
        if (!isTodayValid(campaign.days_of_week))
            continue;
        console.log('Campanha: ', campaign.title, ' - Hoje é dia válido? ', isTodayValid(campaign.days_of_week));
        console.log("📢 Rodando campanha:", campaign.title);
        const customers = await getCustomers(campaign);
        console.log(`Encontrados ${customers.length} clientes para a campanha "${campaign.title}"`);
        for (const customer of customers) {
            await client_1.pool.query(`
        INSERT INTO whatsapp_messages (
          restaurant_id,
          customer_id,
          phone,
          message,
          status,
          campaign_id
        )
        VALUES ($1, $2, $3, $4, 'pending', $5)
      `, [
                campaign.restaurant_id,
                customer.id, // 🔥 agora usando customer_id
                normalizePhone(customer.phone),
                personalizeMessage(campaign.message, customer),
                campaign.id,
            ]);
        }
    }
}
