"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hono_1 = require("hono");
const client_1 = require("../db/client");
const feedback = new hono_1.Hono();
function normalizeAttendantRating(value) {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return null;
    }
    return parsed;
}
function normalizePhone(phone) {
    if (phone.startsWith("55"))
        return phone;
    return `55${phone}`;
}
function buildDetractorAlertMessage(params) {
    const mainReason = params.npsReason || params.comment || "nao informado";
    return [
        `Alerta de feedback detrator no restaurante ${params.restaurantName}.`,
        `Cliente: ${params.customerName}.`,
        `WhatsApp: ${params.customerPhone}.`,
        `Nota: ${params.nps}.`,
        `Motivo da nota: ${mainReason}.`,
        `Comentario livre: ${params.comment || "nao informado"}.`,
        `Mesa: ${params.tableNumber || "nao informada"}.`,
    ].join(" ");
}
async function enqueueDetractorNotifications(params) {
    const settingsResult = await client_1.pool.query(`
    SELECT detractor_alert_enabled, detractor_alert_phones
    FROM restaurant_alert_settings
    WHERE restaurant_id = $1
    LIMIT 1
    `, [params.restaurantId]);
    if (settingsResult.rows.length === 0) {
        console.log("[feedback] restaurante sem configuração de alerta de detrator", {
            restaurantId: params.restaurantId,
        });
        return;
    }
    const settings = settingsResult.rows[0];
    const phones = Array.isArray(settings.detractor_alert_phones)
        ? settings.detractor_alert_phones.filter(Boolean)
        : [];
    if (!settings.detractor_alert_enabled || phones.length === 0) {
        console.log("[feedback] alerta de detrator desativado ou sem números", {
            restaurantId: params.restaurantId,
            enabled: settings.detractor_alert_enabled,
            phoneCount: phones.length,
        });
        return;
    }
    const message = buildDetractorAlertMessage({
        restaurantName: params.restaurantName,
        customerName: params.customerName,
        customerPhone: params.customerPhone,
        nps: params.nps,
        tableNumber: params.tableNumber,
        npsReason: params.npsReason,
        comment: params.comment,
    });
    for (const rawPhone of phones) {
        const phone = normalizePhone(String(rawPhone).replace(/\D/g, ""));
        const insertResult = await client_1.pool.query(`
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
      `, [params.restaurantId, params.customerId, phone, message, null]);
        console.log("[feedback] alerta de detrator enfileirado", {
            customerId: params.customerId,
            notifyPhone: phone,
            messageId: insertResult.rows[0]?.id ?? null,
            tableNumber: params.tableNumber ?? null,
        });
    }
}
feedback.post("/", async (c) => {
    try {
        const body = await c.req.json();
        const { restaurant_slug, customer_id, atendimento, qualidade_comida, tempo_espera, custo_beneficio, nps, nps_reason, comment, attendant_id, attendant_rating, attendant_comment, table_number, } = body;
        const normalizedAttendantRating = normalizeAttendantRating(attendant_rating);
        if (!restaurant_slug || !customer_id) {
            return c.json({ error: "restaurant_slug e customer_id sao obrigatorios" }, 400);
        }
        if (normalizedAttendantRating !== null &&
            (normalizedAttendantRating < 0 || normalizedAttendantRating > 5)) {
            return c.json({ error: "attendant_rating deve estar entre 0 e 5" }, 400);
        }
        const restaurantResult = await client_1.pool.query(`
      SELECT id, name, plan, google_review_url
      FROM restaurants
      WHERE slug = $1
      `, [restaurant_slug]);
        const restaurant = restaurantResult.rows[0];
        if (!restaurant) {
            return c.json({ error: "Restaurante nao encontrado" }, 404);
        }
        const customerResult = await client_1.pool.query(`
      SELECT id, name, phone
      FROM customers
      WHERE id = $1
        AND restaurant_id = $2
      LIMIT 1
      `, [customer_id, restaurant.id]);
        const customer = customerResult.rows[0];
        if (!customer) {
            return c.json({ error: "Cliente nao encontrado" }, 404);
        }
        const feedbackResult = await client_1.pool.query(`
      INSERT INTO feedbacks
      (
        restaurant_id,
        customer_id,
        atendimento,
        qualidade_comida,
        tempo_espera,
        custo_beneficio,
        nps,
        nps_reason,
        comment,
        table_number
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
      `, [
            restaurant.id,
            customer_id,
            atendimento,
            qualidade_comida,
            tempo_espera,
            custo_beneficio,
            nps,
            nps_reason || null,
            comment,
            table_number || null,
        ]);
        const feedbackSaved = feedbackResult.rows[0];
        if (attendant_id && normalizedAttendantRating !== null) {
            await client_1.pool.query(`
        INSERT INTO attendant_ratings
        (
          feedback_id,
          attendant_id,
          customer_id,
          rating,
          comment
        )
        VALUES ($1,$2,$3,$4,$5)
        `, [
                feedbackSaved.id,
                attendant_id,
                customer_id,
                normalizedAttendantRating,
                attendant_comment || null,
            ]);
        }
        let response = {
            success: true,
            feedback: feedbackSaved,
            action: "thank_you",
        };
        if (nps >= 9 && restaurant.google_review_url) {
            response.action = "redirect_google_review";
            response.google_review_url = restaurant.google_review_url;
        }
        if (nps <= 6) {
            response.action = "collect_internal_feedback";
            await enqueueDetractorNotifications({
                restaurantId: restaurant.id,
                restaurantName: restaurant.name,
                customerId: customer.id,
                customerName: customer.name || "Cliente",
                customerPhone: customer.phone,
                nps,
                tableNumber: table_number || null,
                npsReason: nps_reason || null,
                comment: comment || null,
            });
        }
        return c.json(response);
    }
    catch (error) {
        console.error("[feedback] erro ao salvar feedback", error);
        return c.json({ error: "Erro ao salvar feedback" }, 500);
    }
});
exports.default = feedback;
