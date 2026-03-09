import { Hono } from "hono";
import { pool } from "../db/client";
import type { Variables } from "../types/hono";

const feedback = new Hono<{ Variables: Variables }>();


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
      comment
    } = body;

    if (!restaurant_slug || !customer_id) {
      return c.json(
        { error: "restaurant_slug e customer_id são obrigatórios" },
        400
      );
    }

    // 1️⃣ Buscar restaurante
    const restaurantResult = await pool.query(
      `SELECT id, plan, google_review_url
       FROM restaurants
       WHERE slug = $1`,
      [restaurant_slug]
    );

    const restaurant = restaurantResult.rows[0];

    if (!restaurant) {
      return c.json({ error: "Restaurante não encontrado" }, 404);
    }

    const restaurant_id = restaurant.id;

    // 2️⃣ Salvar feedback
    const feedbackResult = await pool.query(
      `INSERT INTO feedbacks
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
      RETURNING *`,
      [
        restaurant_id,
        customer_id,
        atendimento,
        qualidade_comida,
        tempo_espera,
        custo_beneficio,
        nps,
        comment
      ]
    );

    const feedbackSaved = feedbackResult.rows[0];

    // 3️⃣ Lógica de retorno
    let response: any = {
      success: true,
      feedback: feedbackSaved,
      action: "thank_you"
    };

    // Promotores NPS (9 ou 10)
    if (
      nps >= 9 &&
      restaurant.google_review_url &&
      (restaurant.plan === "pro" || restaurant.plan === "premium")
    ) {
      response.action = "redirect_google_review";
      response.google_review_url = restaurant.google_review_url;
    }

    // Detratores
    if (nps <= 6) {
      response.action = "collect_internal_feedback";
    }

    return c.json(response);

  } catch (error) {
    console.error(error);
    return c.json({ error: "Erro ao salvar feedback" }, 500);
  }
});
export default feedback;