"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hono_1 = require("hono");
const db_1 = require("../db");
const auth_1 = require("../middleware/auth");
const attendants = new hono_1.Hono();
/**
 * 🔓 ROTA PÚBLICA (não usa auth)
 */
attendants.get("/public/:restaurant_slug", async (c) => {
    try {
        const restaurant_slug = c.req.param("restaurant_slug");
        const result = await db_1.pool.query(`
      SELECT a.id, a.name, a.photo_url
      FROM attendants a
      JOIN restaurants r ON r.id = a.restaurant_id
      WHERE r.slug = $1
      AND a.active = true
      ORDER BY a.name
      `, [restaurant_slug]);
        return c.json(result.rows);
    }
    catch (error) {
        console.error(error);
        return c.json({ error: "Erro ao buscar atendentes" }, 500);
    }
});
/**
 * 🔒 Middleware de autenticação
 */
attendants.use("*", auth_1.authMiddleware);
/**
 * Criar atendente
 */
attendants.post("/", async (c) => {
    try {
        const { name, photo_url } = await c.req.json();
        const restaurant_id = c.get("user").restaurant_id;
        if (!name) {
            return c.json({ error: "Nome do atendente é obrigatório" }, 400);
        }
        const result = await db_1.pool.query(`
      INSERT INTO attendants (restaurant_id, name, active, photo_url)
      VALUES ($1, $2, $3, $4)
      RETURNING *
      `, [restaurant_id, name, true, photo_url]);
        return c.json(result.rows[0]);
    }
    catch (error) {
        console.error(error);
        return c.json({ error: "Erro ao criar atendente" }, 500);
    }
});
/**
 * Listar atendentes do restaurante
 */
attendants.get("/", async (c) => {
    try {
        const restaurant_id = c.get("user").restaurant_id;
        const result = await db_1.pool.query(`
      SELECT *
      FROM attendants
      WHERE restaurant_id = $1
      AND active = true
      ORDER BY name
      `, [restaurant_id]);
        return c.json(result.rows);
    }
    catch (error) {
        console.error(error);
        return c.json({ error: "Erro ao buscar atendentes" }, 500);
    }
});
/**
 * Desativar atendente
 */
attendants.delete("/:id", async (c) => {
    try {
        const { id } = c.req.param();
        const restaurant_id = c.get("user").restaurant_id;
        const result = await db_1.pool.query(`
      UPDATE attendants
      SET active = false
      WHERE id = $1
      AND restaurant_id = $2
      `, [id, restaurant_id]);
        if (result.rowCount === 0) {
            return c.json({ error: "Atendente não encontrado" }, 404);
        }
        return c.json({ message: "Atendente desativado" });
    }
    catch (error) {
        console.error(error);
        return c.json({ error: "Erro ao remover atendente" }, 500);
    }
});
attendants.put("/:id", auth_1.authMiddleware, async (c) => {
    const user = c.get("user");
    if (!user) {
        return c.json({ error: "Usuário não encontrado" }, 401);
    }
    const id = c.req.param("id");
    const { name, photo_url } = await c.req.json();
    if (!name || !photo_url) {
        return c.json({ error: "Nome e foto são obrigatórios" }, 400);
    }
    const result = await db_1.pool.query(`
    UPDATE attendants
    SET
      name = $1,
      photo_url = $2
    WHERE id = $3
    AND restaurant_id = $4
    RETURNING id, name, photo_url
    `, [name, photo_url, id, user.restaurant_id]);
    if (result.rowCount === 0) {
        return c.json({ error: "Atendente não encontrado" }, 404);
    }
    return c.json({
        message: "Atendente atualizado com sucesso",
        attendant: result.rows[0]
    });
});
exports.default = attendants;
