"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hono_1 = require("hono");
const client_1 = require("../db/client");
const feedback = new hono_1.Hono();
feedback.post("/", async (c) => {
    try {
        const body = await c.req.json();
        const { restaurant_slug, customer_id, atendimento, qualidade_comida, tempo_espera, custo_beneficio, nps, comment, 
        // 🆕 novos campos opcionais
        attendant_id, attendant_rating, attendant_comment } = body;
        if (!restaurant_slug || !customer_id) {
            return c.json({ error: "restaurant_slug e customer_id são obrigatórios" }, 400);
        }
        // 1️⃣ Buscar restaurante
        const restaurantResult = await client_1.pool.query(`SELECT id, plan, google_review_url
       FROM restaurants
       WHERE slug = $1`, [restaurant_slug]);
        const restaurant = restaurantResult.rows[0];
        if (!restaurant) {
            return c.json({ error: "Restaurante não encontrado" }, 404);
        }
        const restaurant_id = restaurant.id;
        // 2️⃣ Salvar feedback
        const feedbackResult = await client_1.pool.query(`INSERT INTO feedbacks
      (
        restaurant_id,
        customer_id,
        atendimento,
        qualidade_comida,
        tempo_espera,
        custo_beneficio,
        nps,
        comment
      )
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
      RETURNING *`, [
            restaurant_id,
            customer_id,
            atendimento,
            qualidade_comida,
            tempo_espera,
            custo_beneficio,
            nps,
            comment
        ]);
        const feedbackSaved = feedbackResult.rows[0];
        // 🆕 3️⃣ Salvar avaliação do atendente (se enviada)
        if (attendant_id && attendant_rating) {
            await client_1.pool.query(`INSERT INTO attendant_ratings
        (
          feedback_id,
          attendant_id,
          customer_id,
          rating,
          comment
        )
        VALUES ($1,$2,$3,$4,$5)`, [
                feedbackSaved.id,
                attendant_id,
                customer_id,
                attendant_rating,
                attendant_comment || null
            ]);
        }
        // 4️⃣ Lógica de retorno
        let response = {
            success: true,
            feedback: feedbackSaved,
            action: "thank_you"
        };
        // Promotores NPS (9 ou 10)
        if (nps >= 9 &&
            restaurant.google_review_url &&
            (restaurant.plan === "pro" || restaurant.plan === "premium")) {
            response.action = "redirect_google_review";
            response.google_review_url = restaurant.google_review_url;
        }
        // Detratores
        if (nps <= 6) {
            response.action = "collect_internal_feedback";
        }
        return c.json(response);
    }
    catch (error) {
        console.error(error);
        return c.json({ error: "Erro ao salvar feedback" }, 500);
    }
});
exports.default = feedback;
