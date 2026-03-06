import { Hono } from "hono";
import { pool } from "../db/client";
import type { Variables } from "../types/hono";
import { v4 as uuidv4 } from "uuid";

const feedback = new Hono<{ Variables: Variables }>();


feedback.post("/", async (c) => {
  try {
    const body = await c.req.json();

    const {
      restaurant_slug,
      rating,
      comment,
      phone,
      birth_day,
      birth_month
    } = body;

    if (!restaurant_slug || !rating) {
      return c.json({ error: "restaurant_slug e rating são obrigatórios" }, 400);
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

    let customer_id: string | null = null;

    // 2️⃣ Buscar ou criar cliente
    if (phone) {
      const customerResult = await pool.query(
        `SELECT id
         FROM customers
         WHERE phone = $1 AND restaurant_id = $2`,
        [phone, restaurant_id]
      );

      let customer = customerResult.rows[0];

      if (!customer) {

        let birthdate = null;

        if (birth_day && birth_month) {
          const day = birth_day.toString().padStart(2, "0");
          const month = birth_month.toString().padStart(2, "0");
          birthdate = `2000-${month}-${day}`;
        }

        const newCustomer = await pool.query(
          `INSERT INTO customers
           (id, restaurant_id, phone, birthdate)
           VALUES ($1,$2,$3,$4)
           RETURNING id`,
          [uuidv4(), restaurant_id, phone, birthdate]
        );

        customer_id = newCustomer.rows[0].id;

      } else {
        customer_id = customer.id;
      }
    }

    // 3️⃣ Salvar feedback
    const feedbackResult = await pool.query(
      `INSERT INTO feedbacks
       (restaurant_id, customer_id, rating, comment)
       VALUES ($1,$2,$3,$4)
       RETURNING *`,
      [restaurant_id, customer_id, rating, comment]
    );

    const feedbackSaved = feedbackResult.rows[0];

    // 4️⃣ Lógica de retorno
    let response: any = {
      success: true,
      feedback: feedbackSaved,
      action: "thank_you"
    };

    // Plano PRO ou PREMIUM + nota alta
    if (
      rating >= 4 &&
      restaurant.google_review_url &&
      (restaurant.plan === "pro" || restaurant.plan === "premium")
    ) {
      response.action = "redirect_google_review";
      response.google_review_url = restaurant.google_review_url;
    }

    // Nota baixa
    if (rating <= 3) {
      response.action = "collect_internal_feedback";
    }

    return c.json(response);

  } catch (error) {
    console.error(error);
    return c.json({ error: "Erro ao salvar feedback" }, 500);
  }
});

export default feedback;