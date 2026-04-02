import { Hono } from "hono";

import { pool } from "../db/client";
import type { Variables } from "../types/hono";

const feedback = new Hono<{ Variables: Variables }>();

function normalizePhone(phone: string) {
  if (phone.startsWith("55")) return phone;
  return `55${phone}`;
}

function buildDetractorAlertMessage(params: {
  template?: string | null;
  restaurantName: string;
  customerName: string;
  nps: number;
  tableNumber?: string | null;
  comment?: string | null;
}) {
  const fallback = [
    `Alerta de detrator no restaurante ${params.restaurantName}.`,
    `Cliente: ${params.customerName}.`,
    `Mesa: ${params.tableNumber || "nao informada"}.`,
    `NPS: ${params.nps}.`,
    `Comentario: ${params.comment || "nao informado"}.`,
  ].join(" ");

  const template = params.template?.trim() ? params.template : fallback;

  return template
    .replace(/\{restaurant_name\}/g, params.restaurantName)
    .replace(/\{name\}/g, params.customerName)
    .replace(/\{customer_name\}/g, params.customerName)
    .replace(/\{nps\}/g, String(params.nps))
    .replace(/\{table_number\}/g, params.tableNumber || "nao informada")
    .replace(/\{comment\}/g, params.comment || "nao informado");
}

async function enqueueDetractorNotifications(params: {
  restaurantId: string;
  restaurantName: string;
  customerId: string;
  customerName: string;
  nps: number;
  tableNumber?: string | null;
  comment?: string | null;
}) {
  const campaignsResult = await pool.query(
    `
    SELECT id, title, custom_filter
    FROM campaigns
    WHERE restaurant_id = $1
      AND active = true
      AND target = 'detractors'
    `,
    [params.restaurantId]
  );

  console.log("[feedback] campanhas de detratores encontradas para alerta", {
    restaurantId: params.restaurantId,
    customerId: params.customerId,
    count: campaignsResult.rows.length,
  });

  for (const campaign of campaignsResult.rows as Array<{
    id: string;
    title: string;
    custom_filter?: {
      notify_phones?: string[];
      notify_message?: string;
    } | null;
  }>) {
    const notifyPhones = Array.isArray(campaign.custom_filter?.notify_phones)
      ? campaign.custom_filter?.notify_phones.filter(Boolean)
      : [];

    if (notifyPhones.length === 0) {
      continue;
    }

    const message = buildDetractorAlertMessage({
      template: campaign.custom_filter?.notify_message ?? null,
      restaurantName: params.restaurantName,
      customerName: params.customerName,
      nps: params.nps,
      tableNumber: params.tableNumber,
      comment: params.comment,
    });

    for (const rawPhone of notifyPhones) {
      const phone = normalizePhone(String(rawPhone).replace(/\D/g, ""));

      const insertResult = await pool.query(
        `
        INSERT INTO whatsapp_alert_messages
        (
          restaurant_id,
          customer_id,
          phone,
          message,
          status,
          campaign_id
        )
        VALUES ($1, $2, $3, $4, 'pending', $5)
        RETURNING id, status, created_at
        `,
        [params.restaurantId, params.customerId, phone, message, campaign.id]
      );

      console.log("[feedback] alerta de detrator enfileirado", {
        campaignId: campaign.id,
        customerId: params.customerId,
        notifyPhone: phone,
        messageId: insertResult.rows[0]?.id ?? null,
        tableNumber: params.tableNumber ?? null,
      });
    }
  }
}

feedback.post("/", async (c) => {
  try {
    const body = await c.req.json();

    const {
      restaurant_slug,
      customer_id,
      atendimento,
      qualidade_comida,
      tempo_espera,
      custo_beneficio,
      nps,
      comment,
      attendant_id,
      attendant_rating,
      attendant_comment,
      table_number,
    } = body;

    if (!restaurant_slug || !customer_id) {
      return c.json(
        { error: "restaurant_slug e customer_id sao obrigatorios" },
        400
      );
    }

    const restaurantResult = await pool.query(
      `
      SELECT id, name, plan, google_review_url
      FROM restaurants
      WHERE slug = $1
      `,
      [restaurant_slug]
    );

    const restaurant = restaurantResult.rows[0];

    if (!restaurant) {
      return c.json({ error: "Restaurante nao encontrado" }, 404);
    }

    const customerResult = await pool.query(
      `
      SELECT id, name, phone
      FROM customers
      WHERE id = $1
        AND restaurant_id = $2
      LIMIT 1
      `,
      [customer_id, restaurant.id]
    );

    const customer = customerResult.rows[0];

    if (!customer) {
      return c.json({ error: "Cliente nao encontrado" }, 404);
    }

    const feedbackResult = await pool.query(
      `
      INSERT INTO feedbacks
      (
        restaurant_id,
        customer_id,
        atendimento,
        qualidade_comida,
        tempo_espera,
        custo_beneficio,
        nps,
        comment,
        table_number
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      RETURNING *
      `,
      [
        restaurant.id,
        customer_id,
        atendimento,
        qualidade_comida,
        tempo_espera,
        custo_beneficio,
        nps,
        comment,
        table_number || null,
      ]
    );

    const feedbackSaved = feedbackResult.rows[0];

    if (attendant_id && attendant_rating) {
      await pool.query(
        `
        INSERT INTO attendant_ratings
        (
          feedback_id,
          attendant_id,
          customer_id,
          rating,
          comment
        )
        VALUES ($1,$2,$3,$4,$5)
        `,
        [
          feedbackSaved.id,
          attendant_id,
          customer_id,
          attendant_rating,
          attendant_comment || null,
        ]
      );
    }

    let response: any = {
      success: true,
      feedback: feedbackSaved,
      action: "thank_you",
    };

    if (
      nps >= 9 &&
      restaurant.google_review_url &&
      (restaurant.plan === "pro" || restaurant.plan === "premium")
    ) {
      response.action = "redirect_google_review";
      response.google_review_url = restaurant.google_review_url;
    }

    if (nps <= 6) {
      response.action = "collect_internal_feedback";

      const canUseDetractorAlerts =
        restaurant.plan === "pro" || restaurant.plan === "premium";

      console.log("[feedback] validando alerta de detrator por plano", {
        restaurantId: restaurant.id,
        plan: restaurant.plan,
        canUseDetractorAlerts,
      });

      if (canUseDetractorAlerts) {
        await enqueueDetractorNotifications({
          restaurantId: restaurant.id,
          restaurantName: restaurant.name,
          customerId: customer.id,
          customerName: customer.name || "Cliente",
          nps,
          tableNumber: table_number || null,
          comment: comment || null,
        });
      }
    }

    return c.json(response);
  } catch (error) {
    console.error("[feedback] erro ao salvar feedback", error);
    return c.json({ error: "Erro ao salvar feedback" }, 500);
  }
});

export default feedback;
