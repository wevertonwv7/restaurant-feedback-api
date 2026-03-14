import ExcelJS from "exceljs";
import { Hono } from "hono";
import { pool } from "../db/client";
import { authMiddleware } from "../middleware/auth";       
import { Variables } from "../types/hono";  

const reports = new Hono<{ Variables: Variables }>();

reports.get("/excel", authMiddleware, async (c) => {
  const user = c.get("user");

  if (!user) {
    return c.json({ error: "Usuário não encontrado" }, 401);
  }

  const period = c.req.query("period");
  const startDate = c.req.query("start_date");
  const endDate = c.req.query("end_date");

  let dateFilter = "AND f.created_at >= DATE_TRUNC('month', NOW())";
  const params: any[] = [user.restaurant_id];

  if (period === "1m") dateFilter = "AND f.created_at >= NOW() - INTERVAL '1 month'";
  if (period === "3m") dateFilter = "AND f.created_at >= NOW() - INTERVAL '3 months'";
  if (period === "6m") dateFilter = "AND f.created_at >= NOW() - INTERVAL '6 months'";
  if (period === "12m") dateFilter = "AND f.created_at >= NOW() - INTERVAL '12 months'";

  if (startDate && endDate) {
    params.push(startDate, endDate);
    dateFilter = `AND f.created_at BETWEEN $2 AND $3`;
  }

  /*
  =============================
  LABEL DO PERÍODO
  =============================
  */

  let periodLabel = "Mês atual";

  if (period === "1m") periodLabel = "Últimos 30 dias";
  if (period === "3m") periodLabel = "Últimos 3 meses";
  if (period === "6m") periodLabel = "Últimos 6 meses";
  if (period === "12m") periodLabel = "Últimos 12 meses";

  if (startDate && endDate) {
    periodLabel = `${startDate} até ${endDate}`;
  }

  const workbook = new ExcelJS.Workbook();

  /*
  =============================
  ABA 1 — RESUMO DASHBOARD
  =============================
  */

  const metrics = await pool.query(
    `SELECT
      ROUND(AVG(atendimento),2) as atendimento,
      ROUND(AVG(qualidade_comida),2) as qualidade,
      ROUND(AVG(tempo_espera),2) as tempo,
      ROUND(AVG(custo_beneficio),2) as custo,

      COUNT(*) FILTER (WHERE nps >= 9) promoters,
      COUNT(*) FILTER (WHERE nps BETWEEN 7 AND 8) neutrals,
      COUNT(*) FILTER (WHERE nps <= 6) detractors,
      COUNT(*) total
     FROM feedbacks f
     WHERE restaurant_id = $1
     ${dateFilter}`,
    params
  );

  const m = metrics.rows[0];

  const nps =
    m.total > 0
      ? Math.round(((m.promoters - m.detractors) / m.total) * 100)
      : 0;

  const sheetDashboard = workbook.addWorksheet("Resumo");

  sheetDashboard.columns = [
    { width: 30 },
    { width: 20 }
  ];

  sheetDashboard.addRow(["Período do Relatório", periodLabel]);
  sheetDashboard.addRow([]);

  sheetDashboard.addRow(["Média Atendimento", m.atendimento]);
  sheetDashboard.addRow(["Média Qualidade", m.qualidade]);
  sheetDashboard.addRow(["Média Tempo Espera", m.tempo]);
  sheetDashboard.addRow(["Média Custo Benefício", m.custo]);
  sheetDashboard.addRow([]);

  sheetDashboard.addRow(["Promoters", m.promoters]);
  sheetDashboard.addRow(["Neutrals", m.neutrals]);
  sheetDashboard.addRow(["Detractors", m.detractors]);
  sheetDashboard.addRow(["NPS Total", nps]);

  /*
  =============================
  ABA 2 — FEEDBACKS
  =============================
  */

  const feedbacks = await pool.query(
    `SELECT
      c.name,
      f.atendimento,
      f.qualidade_comida,
      f.tempo_espera,
      f.custo_beneficio,
      f.nps,
      f.comment,
      f.created_at
     FROM feedbacks f
     LEFT JOIN customers c ON c.id = f.customer_id
     WHERE f.restaurant_id = $1
     ${dateFilter}
     ORDER BY f.created_at DESC`,
    params
  );

  const sheetFeedbacks = workbook.addWorksheet("Feedbacks");

  sheetFeedbacks.columns = [
    { header: "Cliente", key: "cliente", width: 28 },
    { header: "Atendimento", key: "atendimento", width: 15 },
    { header: "Qualidade Comida", key: "qualidade", width: 18 },
    { header: "Tempo Espera", key: "tempo", width: 18 },
    { header: "Custo Benefício", key: "custo", width: 18 },
    { header: "NPS", key: "nps", width: 10 },
    { header: "Comentário", key: "comentario", width: 55 },
    { header: "Data", key: "data", width: 18 }
  ];

  sheetFeedbacks.getColumn("comentario").alignment = { wrapText: true };

  feedbacks.rows.forEach((f) => {
    sheetFeedbacks.addRow({
      cliente: f.name,
      atendimento: f.atendimento,
      qualidade: f.qualidade_comida,
      tempo: f.tempo_espera,
      custo: f.custo_beneficio,
      nps: f.nps,
      comentario: f.comment,
      data: f.created_at
    });
  });

  /*
  =============================
  ABA 3 — RANKING ATENDENTES
  =============================
  */

  const ranking = await pool.query(
    `SELECT
      a.id,
      a.name,
      COUNT(ar.id) AS total_avaliacoes,
      ROUND(AVG(ar.rating), 2) AS media_rating
     FROM attendant_ratings ar
     JOIN attendants a ON a.id = ar.attendant_id
     JOIN feedbacks f ON f.id = ar.feedback_id
     WHERE f.restaurant_id = $1
     ${dateFilter}
     GROUP BY a.id, a.name
     ORDER BY media_rating DESC`,
    params
  );

  const sheetRanking = workbook.addWorksheet("Ranking Atendentes");

  sheetRanking.columns = [
    { header: "Atendente", key: "name", width: 30 },
    { header: "Média Avaliação", key: "media_rating", width: 20 },
    { header: "Total Avaliações", key: "total_avaliacoes", width: 20 }
  ];

  ranking.rows.forEach((r) => sheetRanking.addRow(r));

  /*
  =============================
  ABA 4 — AVALIAÇÕES ATENDENTES
  =============================
  */

  const attendantFeedbacks = await pool.query(
    `SELECT
      a.name AS attendant,
      c.name AS customer,
      ar.rating,
      ar.comment,
      f.atendimento,
      f.created_at
     FROM attendant_ratings ar
     JOIN attendants a ON a.id = ar.attendant_id
     JOIN feedbacks f ON f.id = ar.feedback_id
     LEFT JOIN customers c ON c.id = f.customer_id
     WHERE f.restaurant_id = $1
     ${dateFilter}
     ORDER BY a.name, f.created_at DESC`,
    params
  );

  const sheetAttendant = workbook.addWorksheet("Avaliações Atendentes");

  sheetAttendant.columns = [
    { header: "Atendente", key: "attendant", width: 28 },
    { header: "Cliente", key: "customer", width: 28 },
    { header: "Nota Atendimento", key: "nota", width: 18 },
    { header: "Comentário", key: "comentario", width: 55 },
    { header: "Data", key: "data", width: 18 }
  ];

  sheetAttendant.getColumn("comentario").alignment = { wrapText: true };

  attendantFeedbacks.rows.forEach((r) => {
    sheetAttendant.addRow({
      attendant: r.attendant,
      customer: r.customer,
      nota: r.atendimento,
      comentario: r.comment,
      data: r.created_at
    });
  });

  /*
  =============================
  GERAR ARQUIVO
  =============================
  */

  const buffer = await workbook.xlsx.writeBuffer();

  c.header(
    "Content-Disposition",
    "attachment; filename=relatorio-feedbacks.xlsx"
  );

  return c.body(buffer);
});

export default reports;
