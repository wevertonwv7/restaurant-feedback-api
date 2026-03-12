import { Hono } from "hono";
import { pool } from "../db/client";
import type { Variables } from "../types/hono";
import { authMiddleware } from "../middleware/auth";

const metrics = new Hono<{ Variables: Variables }>();

metrics.get("/", authMiddleware, async (c) => {
  const user = c.get("user");

  if (!user) {
    return c.json({ error: "Usuário não encontrado" }, 401);
  }

  const period = c.req.query("period");
  const startDate = c.req.query("start_date");
  const endDate = c.req.query("end_date");

  let dateFilter = "";
  const params: any[] = [user.restaurant_id];

  if (period === "1m") {
    dateFilter = "AND created_at >= NOW() - INTERVAL '1 month'";
  }

  if (period === "3m") {
    dateFilter = "AND created_at >= NOW() - INTERVAL '3 months'";
  }

  if (period === "6m") {
    dateFilter = "AND created_at >= NOW() - INTERVAL '6 months'";
  }

  if (period === "12m") {
    dateFilter = "AND created_at >= NOW() - INTERVAL '12 months'";
  }

  if (startDate && endDate) {
    params.push(startDate, endDate);
    dateFilter = `AND created_at BETWEEN $2 AND $3`;
  }

  const result = await pool.query(
    `SELECT
      COUNT(*) AS total_feedbacks,

      ROUND(AVG(atendimento), 2) AS avg_atendimento,
      ROUND(AVG(qualidade_comida), 2) AS avg_qualidade_comida,
      ROUND(AVG(tempo_espera), 2) AS avg_tempo_espera,
      ROUND(AVG(custo_beneficio), 2) AS avg_custo_beneficio,

      COUNT(*) FILTER (WHERE nps >= 9) AS promoters,
      COUNT(*) FILTER (WHERE nps BETWEEN 7 AND 8) AS neutrals,
      COUNT(*) FILTER (WHERE nps <= 6) AS detractors,

      COUNT(*) FILTER (
        WHERE created_at::date = CURRENT_DATE
      ) AS today_feedbacks

     FROM feedbacks
     WHERE restaurant_id = $1
     ${dateFilter}`,
    params
  );

  const data = result.rows[0];

  const total = Number(data.total_feedbacks);
  const promoters = Number(data.promoters);
  const detractors = Number(data.detractors);

  const nps =
    total > 0 ? Math.round(((promoters - detractors) / total) * 100) : 0;

  return c.json({
    total_feedbacks: total,
    today_feedbacks: Number(data.today_feedbacks),

    ratings: {
      atendimento: Number(data.avg_atendimento) || 0,
      qualidade_comida: Number(data.avg_qualidade_comida) || 0,
      tempo_espera: Number(data.avg_tempo_espera) || 0,
      custo_beneficio: Number(data.avg_custo_beneficio) || 0
    },

    nps,

    nps_breakdown: {
      promoters,
      neutrals: Number(data.neutrals),
      detractors
    }
  });
});

export default metrics;