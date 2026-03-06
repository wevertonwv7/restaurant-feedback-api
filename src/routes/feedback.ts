import { Hono } from "hono";
import { pool } from "../db/client";
import { authMiddleware } from "../middleware/auth";
import type { Variables } from "../types/hono";

const feedback = new Hono<{ Variables: Variables }>();


feedback.post("/", async (c) => {
  try {
    const body = await c.req.json();

    // Pegamos os dados enviados pelo cliente
    const { restaurant_id, customer_id, rating, comment } = body;

    // Inserimos no banco apenas as colunas existentes
    const result = await pool.query(
      `INSERT INTO feedbacks
       (restaurant_id, customer_id, rating, comment)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [restaurant_id, customer_id, rating, comment]
    );

    return c.json({
      success: true,
      feedback: result.rows[0],
    });

  } catch (error) {
    console.error(error);
    return c.json({ error: "Erro ao salvar feedback" }, 500);
  }
});


feedback.get("/", authMiddleware, async (c) => {

  const user = c.get("user");

  const result = await pool.query(
    `SELECT *
     FROM feedbacks
     WHERE restaurant_id = $1
     ORDER BY created_at DESC`,
    [user.restaurant_id]
  );

  return c.json(result.rows);
});



export default feedback;