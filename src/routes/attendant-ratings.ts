import { Hono } from "hono";
import { pool } from "../db";
import { authMiddleware } from "../middleware/auth";
import type { Variables } from "../types/hono";

const attendantRatings = new Hono<{ Variables: Variables }>();

attendantRatings.use("*", authMiddleware);

/**
 * Dashboard - média por atendente
 */
attendantRatings.get("/summary/:restaurant_id", async (c) => {
  try {
    const user = c.get("user");
    const { restaurant_id } = c.req.param();

    if (restaurant_id !== user.restaurant_id) {
      return c.json({ error: "Acesso negado" }, 403);
    }

    const result = await pool.query(
      `
      SELECT 
        a.id,
        a.name,
        COUNT(ar.id) AS total_avaliacoes,
        ROUND(AVG(ar.rating),2) AS media
      FROM attendants a
      LEFT JOIN attendant_ratings ar
      ON ar.attendant_id = a.id
      WHERE a.restaurant_id = $1 
      AND a.active = true
      GROUP BY a.id
      ORDER BY media DESC
      `,
      [restaurant_id]
    );

    return c.json(
      result.rows.map((row) => ({
        id: row.id,
        name: row.name,
        total_avaliacoes: Number(row.total_avaliacoes) || 0,
        media: Number(row.media) || 0
      }))
    );

  } catch (error) {
    console.error(error);
    return c.json({ error: "Erro ao buscar métricas de atendentes" }, 500);
  }
});

/**
 * Listar avaliações de atendentes (com paginação)
 */
attendantRatings.get("/reviews/:restaurant_id", async (c) => {
  try {
    const user = c.get("user");
    const { restaurant_id } = c.req.param();

    if (restaurant_id !== user.restaurant_id) {
      return c.json({ error: "Acesso negado" }, 403);
    }

    const page = Number(c.req.query("page") || 1);
    const limit = Number(c.req.query("limit") || 10);
    const offset = (page - 1) * limit;

    const result = await pool.query(
      `
      SELECT
        ar.id,
        a.name AS attendant_name,
        ar.rating,
        ar.comment,
        ar.created_at
      FROM attendant_ratings ar
      JOIN attendants a ON a.id = ar.attendant_id
      WHERE a.restaurant_id = $1
      ORDER BY ar.created_at DESC
      LIMIT $2 OFFSET $3
      `,
      [restaurant_id, limit, offset]
    );

    const countResult = await pool.query(
      `
      SELECT COUNT(*)
      FROM attendant_ratings ar
      JOIN attendants a ON a.id = ar.attendant_id
      WHERE a.restaurant_id = $1
      `,
      [restaurant_id]
    );

    const total = Number(countResult.rows[0].count);
    const totalPages = Math.ceil(total / limit);

    return c.json({
      page,
      limit,
      total,
      totalPages,
      data: result.rows
    });

  } catch (error) {
    console.error(error);
    return c.json({ error: "Erro ao buscar avaliações de atendentes" }, 500);
  }
});

export default attendantRatings;
