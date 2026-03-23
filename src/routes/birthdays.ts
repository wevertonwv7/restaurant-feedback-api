import { Hono } from "hono";
import{ Variables } from "../types/hono";
import { pool } from "../db/client";
import { authMiddleware } from "../middleware/auth";


const birthdays = new Hono<{ Variables: Variables }>();

birthdays.get("/", authMiddleware, async (c) => {
  try {
    const restaurant_id = c.get("user").restaurant_id;

    const result = await pool.query(
      `
      SELECT
        id,
        name,
        phone
      FROM customers
      WHERE restaurant_id = $1
      AND EXTRACT(DAY FROM birthdate) = EXTRACT(DAY FROM CURRENT_DATE)
      AND EXTRACT(MONTH FROM birthdate) = EXTRACT(MONTH FROM CURRENT_DATE)
      `,
      [restaurant_id]
    );

    return c.json(result.rows);

  } catch (error) {
    console.error(error);
    return c.json({ error: "Erro ao buscar aniversariantes do dia" }, 500);
  }
});


export default birthdays;
