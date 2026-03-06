// src/routes/feedbacks.ts
import { Hono } from "hono";
import { pool } from "../db/client";
import { authMiddleware } from "../middleware/auth";
import type { Variables } from "../types/hono";

const feedbacks = new Hono<{ Variables: Variables }>();

// GET /feedbacks -> lista feedbacks do restaurante do usuário
feedbacks.get("/", authMiddleware, async (c) => {
  const user = c.get("user"); // o authMiddleware já coloca o usuário aqui

  if (!user) {
    return c.json({ error: "Usuário não encontrado" }, 401);
  }

  const result = await pool.query(
    `SELECT id, customer_id, rating, comment, created_at
     FROM feedbacks
     WHERE restaurant_id = $1
     ORDER BY created_at DESC`,
    [user.restaurant_id]
  );

  // Retorna no formato esperado pelo Lovable
  return c.json({
    feedbacks: result.rows,
    total: result.rows.length,
    average_rating:
      result.rows.reduce((acc, f) => acc + f.rating, 0) / (result.rows.length || 1),
    today_count: result.rows.filter(
      (f) =>
        new Date(f.created_at).toDateString() === new Date().toDateString()
    ).length,
  });
});

export default feedbacks;