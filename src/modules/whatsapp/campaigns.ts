import { pool } from "../../db/client";

const SAO_PAULO_TIMEZONE = "America/Sao_Paulo";

function getSaoPauloNow() {
  const now = new Date();
  return new Date(now.toLocaleString("en-US", { timeZone: SAO_PAULO_TIMEZONE }));
}

function getScheduledTime(sendTime: string) {
  const now = getSaoPauloNow();
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
  const today = getSaoPauloNow().getDay();
  return days.includes(today);
}

function shouldProcessScheduledCampaign(sendTime: string) {
  const now = getSaoPauloNow();
  const [hour, minute] = sendTime.split(":").map(Number);

  return now.getHours() === hour && now.getMinutes() === minute;
}

async function alreadyQueuedForCampaignToday(campaignId: string, customerId: string) {
  const result = await pool.query(
    `
    SELECT id, status, scheduled_at, sent_at, created_at
    FROM whatsapp_messages
    WHERE campaign_id = $1
      AND customer_id = $2
      AND DATE(COALESCE(scheduled_at, sent_at, created_at) AT TIME ZONE '${SAO_PAULO_TIMEZONE}') =
          DATE(NOW() AT TIME ZONE '${SAO_PAULO_TIMEZONE}')
    LIMIT 1
    `,
    [campaignId, customerId]
  );

  return result.rows[0] ?? null;
}

async function getCustomers(campaign: any) {
  const { target, restaurant_id, custom_filter } = campaign;

  if (target === "detractors") {
    const res = await pool.query(
      `
      SELECT DISTINCT a.*
      FROM customers a
      JOIN feedbacks f ON f.customer_id = a.id
      WHERE a.restaurant_id = $1
        AND a.consent_lgpd = true
        AND f.nps <= 3
        AND f.created_at >= NOW() - INTERVAL '15 minutes'
      `,
      [restaurant_id]
    );

    return res.rows;
  }

  if (target === "birthday") {
    const res = await pool.query(
      `
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
        )
      `,
      [restaurant_id, campaign.id]
    );

    return res.rows;
  }

  if (target === "custom") {
    let query = `
      SELECT * FROM customers c
      WHERE c.restaurant_id = $1
        AND c.consent_lgpd = true
    `;

    const values: any[] = [restaurant_id];
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

  console.log("[campaigns] campanhas ativas carregadas", {
    count: campaigns.rows.length,
  });

  for (const campaign of campaigns.rows) {
    if (!isTodayValid(campaign.days_of_week)) {
      continue;
    }

    if (campaign.target !== "detractors" && !shouldProcessScheduledCampaign(campaign.send_time)) {
      continue;
    }

    const customers = await getCustomers(campaign);

    console.log("[campaigns] clientes elegíveis", {
      campaignId: campaign.id,
      target: campaign.target,
      count: customers.length,
    });

    for (const customer of customers) {
      const existingMessage = await alreadyQueuedForCampaignToday(campaign.id, customer.id);

      if (existingMessage) {
        console.log("[campaigns] cliente já possui mensagem para esta campanha hoje, ignorando", {
          campaignId: campaign.id,
          customerId: customer.id,
          messageId: existingMessage.id,
          status: existingMessage.status,
        });
        continue;
      }

      let scheduledAt: Date;

      if (campaign.target === "detractors") {
        scheduledAt = new Date(Date.now() + 2 * 60 * 1000);
      } else {
        scheduledAt = getScheduledTime(campaign.send_time);
      }

      const normalizedPhone = normalizePhone(customer.phone);
      const personalizedText = personalizeMessage(campaign.message, customer);

      const insertResult = await pool.query(
        `
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
        RETURNING id, status, scheduled_at
        `,
        [
          campaign.restaurant_id,
          customer.id,
          normalizedPhone,
          personalizedText,
          campaign.id,
          scheduledAt,
        ]
      );

      console.log("[campaigns] mensagem criada", {
        campaignId: campaign.id,
        customerId: customer.id,
        customerName: customer.name,
        messageId: insertResult.rows[0]?.id ?? null,
        scheduledAt,
        sendTime: campaign.send_time,
      });
    }
  }
}
