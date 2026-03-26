"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.processCampaigns = processCampaigns;
const client_1 = require("../../db/client");
const SAO_PAULO_TIMEZONE = "America/Sao_Paulo";
function getSaoPauloNow() {
    const now = new Date();
    return new Date(now.toLocaleString("en-US", { timeZone: SAO_PAULO_TIMEZONE }));
}
function getScheduledTime(sendTime) {
    const now = getSaoPauloNow();
    const [hour, minute] = sendTime.split(":").map(Number);
    const scheduled = new Date(now);
    scheduled.setHours(hour, minute, 0, 0);
    return scheduled;
}
function normalizePhone(phone) {
    if (phone.startsWith("55"))
        return phone;
    return "55" + phone;
}
function personalizeMessage(message, customer) {
    return message.replace("{name}", customer.name || "");
}
function isTodayValid(days) {
    const today = getSaoPauloNow().getDay();
    return days.includes(today);
}
function shouldProcessScheduledCampaign(sendTime) {
    const now = getSaoPauloNow();
    const [hour, minute] = sendTime.split(":").map(Number);
    return now.getHours() === hour && now.getMinutes() === minute;
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
      AND f.created_at >= NOW() - INTERVAL '15 minutes'
      AND NOT EXISTS (
        SELECT 1
        FROM whatsapp_messages wm
        WHERE wm.customer_id = a.id
        AND wm.campaign_id IS NOT NULL
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
      AND EXTRACT(DAY FROM c.birthdate) = EXTRACT(DAY FROM NOW() AT TIME ZONE '${SAO_PAULO_TIMEZONE}')
      AND EXTRACT(MONTH FROM c.birthdate) = EXTRACT(MONTH FROM NOW() AT TIME ZONE '${SAO_PAULO_TIMEZONE}')
      AND NOT EXISTS (
        SELECT 1
        FROM whatsapp_messages wm
        WHERE wm.customer_id = c.id
        AND wm.campaign_id = $2
        AND DATE(COALESCE(wm.scheduled_at, wm.sent_at, wm.created_at) AT TIME ZONE '${SAO_PAULO_TIMEZONE}') =
            DATE(NOW() AT TIME ZONE '${SAO_PAULO_TIMEZONE}')
      );
    `, [restaurant_id, campaign.id]);
        return res.rows;
    }
    if (target === "custom") {
        let query = `
      SELECT * FROM customers c
      WHERE c.restaurant_id = $1
      AND c.consent_lgpd = true
    `;
        const values = [restaurant_id];
        let index = 2;
        if (custom_filter?.min_rating) {
            query += ` AND c.rating >= $${index}`;
            values.push(custom_filter.min_rating);
            index++;
        }
        if (custom_filter?.max_rating) {
            query += ` AND c.rating <= $${index}`;
            values.push(custom_filter.max_rating);
            index++;
        }
        query += `
      AND NOT EXISTS (
        SELECT 1
        FROM whatsapp_messages wm
        WHERE wm.customer_id = c.id
        AND wm.campaign_id = $${index}
        AND DATE(COALESCE(wm.scheduled_at, wm.sent_at, wm.created_at) AT TIME ZONE '${SAO_PAULO_TIMEZONE}') =
            DATE(NOW() AT TIME ZONE '${SAO_PAULO_TIMEZONE}')
      )
    `;
        values.push(campaign.id);
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
    for (const campaign of campaigns.rows) {
        if (!isTodayValid(campaign.days_of_week))
            continue;
        if (campaign.target !== "detractors" && !shouldProcessScheduledCampaign(campaign.send_time))
            continue;
        const customers = await getCustomers(campaign);
        for (const customer of customers) {
            let scheduledAt;
            if (campaign.target === "detractors") {
                // ⚡ delay de 5 minutos
                scheduledAt = new Date(Date.now() + 5 * 60 * 1000);
            }
            else {
                // 📢 usa horário da campanha
                scheduledAt = getScheduledTime(campaign.send_time);
            }
            await client_1.pool.query(`
        INSERT INTO whatsapp_messages (
          restaurant_id,
          customer_id,
          phone,
          message,
          status,
          campaign_id,
          scheduled_at
        )
        VALUES ($1, $2, $3, $4, 'pending', $5, $6)
      `, [
                campaign.restaurant_id,
                customer.id,
                normalizePhone(customer.phone),
                personalizeMessage(campaign.message, customer),
                campaign.id,
                scheduledAt
            ]);
            console.log('scheduledAt: ', scheduledAt, ' - send_time: ', campaign.send_time, ' - customer: ', customer.name); // DEBUG
        }
    }
}
