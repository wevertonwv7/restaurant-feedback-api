// src/routes/feedbacks.ts
import { Hono } from "hono";
import { pool } from "../db/client";
import { authMiddleware } from "../middleware/auth";
import type { Variables } from "../types/hono";

const feedbacks = new Hono<{ Variables: Variables }>();

// GET /feedbacks -> lista feedbacks do restaurante do usuário
feedbacks.get("/", authMiddleware, async (c) => {
  const user = c.get("user");

  if (!user) {
    return c.json({ error: "Usuário não encontrado" }, 401);
  }

  const page = Number(c.req.query("page") || 1);
  const limit = Number(c.req.query("limit") || 10);
  const offset = (page - 1) * limit;

    const period = c.req.query("period");
  const startDate = c.req.query("start_date");
  const endDate = c.req.query("end_date");

  let dateFilter = "";
  const params: any[] = [user.restaurant_id];

  if (period === "1m") {
    dateFilter = "AND f.created_at >= NOW() - INTERVAL '1 month'";
  }

  if (period === "3m") {
    dateFilter = "AND f.created_at >= NOW() - INTERVAL '3 months'";
  }

  if (period === "6m") {
    dateFilter = "AND f.created_at >= NOW() - INTERVAL '6 months'";
  }

  if (period === "12m") {
    dateFilter = "AND f.created_at >= NOW() - INTERVAL '12 months'";
  }

  if (startDate && endDate) {
    params.push(startDate, endDate);
    dateFilter = `AND f.created_at BETWEEN $2 AND $3`;
  }

  const feedbacksResult = await pool.query(
    `SELECT
      f.id,
      f.customer_id,
      f.atendimento,
      f.qualidade_comida,
      f.tempo_espera,
      f.custo_beneficio,
      f.nps,
      f.comment,
      f.created_at,
      c.name
     FROM feedbacks f
     LEFT JOIN customers c ON c.id = f.customer_id
     WHERE f.restaurant_id = $1
     ${dateFilter}
     ORDER BY f.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );

  const totalResult = await pool.query(
    `SELECT COUNT(*) 
     FROM feedbacks f
     WHERE f.restaurant_id = $1
     ${dateFilter}`,
    params
  );

  const total = Number(totalResult.rows[0].count);

  return c.json({
    feedbacks: feedbacksResult.rows,
    pagination: {
      page,
      limit,
      total,
      total_pages: Math.ceil(total / limit)
    }
  });
});

export default feedbacks;