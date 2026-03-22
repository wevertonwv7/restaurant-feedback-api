import { pool } from "../../db/client";

function getScheduledTime(sendTime: string) {
  const now = new Date();

  const [hour, minute] = sendTime.split(":").map(Number);

  const scheduled = new Date(now);

  scheduled.setHours(hour, minute, 0, 0);

  return scheduled;
}

function normalizePhone(phone: string) {
  if (phone.startsWith("55")) return phone;
  return "55" + phone;
}

function personalizeMessage(message: string, customer: any) {
  return message.replace("{name}", customer.name || "");
}

function isTodayValid(days: number[]) {
  const today = new Date().getDay();
  return days.includes(today);
}

async function getCustomers(campaign: any) {
  const { target, restaurant_id, custom_filter } = campaign;

  if (target === "detractors") {
    const res = await pool.query(`
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
    const res = await pool.query(`
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

    const values: any[] = [restaurant_id];
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

    const res = await pool.query(query, values);
    return res.rows;
  }

  return [];
}

export async function processCampaigns() {
  const campaigns = await pool.query(`
    SELECT * FROM campaigns
    WHERE active = true
  `);

  console.log(`🔎 Encontradas ${campaigns.rows.length} campanhas ativas`);

  for (const campaign of campaigns.rows) {

    if (!isTodayValid(campaign.days_of_week)) continue;

    console.log("📢 Rodando campanha:", campaign.title);

    const customers = await getCustomers(campaign);

    console.log(`Encontrados ${customers.length} clientes`);

    for (const customer of customers) {

      let scheduledAt;

      if (campaign.target === "detractors") {
        // ⚡ delay de 5 minutos
        scheduledAt = new Date(Date.now() + 5 * 60 * 1000);
      } else {
        // 📢 usa horário da campanha
        scheduledAt = getScheduledTime(campaign.send_time);
      }

      await pool.query(`
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
    }
  }
}