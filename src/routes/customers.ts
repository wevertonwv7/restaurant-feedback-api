import { Hono } from "hono";
import { v4 as uuidv4 } from "uuid";

import { pool } from "../db/client";
import type { Variables } from "../types/hono";

const customers = new Hono<{ Variables: Variables }>();

function buildBirthdate(birthDay?: string | number, birthMonth?: string | number) {
  if (!birthDay || !birthMonth) {
    return null;
  }

  const day = Number(birthDay);
  const month = Number(birthMonth);

  if (!Number.isInteger(day) || !Number.isInteger(month)) {
    throw new Error("birth_day e birth_month devem ser inteiros válidos");
  }

  if (day < 1 || day > 31 || month < 1 || month > 12) {
    throw new Error("birth_day ou birth_month fora do intervalo válido");
  }

  const birthdate = new Date(Date.UTC(2000, month - 1, day));

  if (
    birthdate.getUTCFullYear() !== 2000 ||
    birthdate.getUTCMonth() !== month - 1 ||
    birthdate.getUTCDate() !== day
  ) {
    throw new Error("Combinação de birth_day e birth_month inválida");
  }

  return `2000-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

customers.post("/", async (c) => {
  try {
    const body = await c.req.json();

    const {
      restaurant_slug,
      name,
      phone,
      birth_day,
      birth_month,
      consent_lgpd,
    } = body;

    const phoneAtualizado = "55" + phone;

    if (!restaurant_slug || !phone || !consent_lgpd) {
      return c.json({ error: "Dados obrigatÃ³rios faltando" }, 400);
    }

    const restaurantResult = await pool.query(
      `SELECT id FROM restaurants WHERE slug = $1`,
      [restaurant_slug]
    );

    const restaurant = restaurantResult.rows[0];

    if (!restaurant) {
      return c.json({ error: "Restaurante nÃ£o encontrado" }, 404);
    }

    const restaurant_id = restaurant.id;

    const customerResult = await pool.query(
      `SELECT id FROM customers
       WHERE phone = $1 AND restaurant_id = $2`,
      [phoneAtualizado, restaurant_id]
    );

    let customer_id;
    const birthdate = buildBirthdate(birth_day, birth_month);

    if (customerResult.rows.length > 0) {
      customer_id = customerResult.rows[0].id;

      const updatedCustomer = await pool.query(
        `
        UPDATE customers
        SET name = $1,
            birthdate = $2,
            consent_lgpd = $3
        WHERE id = $4
        RETURNING id, birthdate
        `,
        [name, birthdate, consent_lgpd, customer_id]
      );

      console.log("[customers] cliente existente atualizado", {
        customerId: customer_id,
        restaurantSlug: restaurant_slug,
        phone: phoneAtualizado,
        birth_day,
        birth_month,
        birthdate,
        savedBirthdate: updatedCustomer.rows[0]?.birthdate ?? null,
      });
    } else {
      console.log("[customers] preparando novo cliente", {
        restaurantSlug: restaurant_slug,
        restaurantId: restaurant_id,
        name,
        originalPhone: phone,
        normalizedPhone: phoneAtualizado,
        birth_day,
        birth_month,
        birthdate,
      });

      const newCustomer = await pool.query(
        `INSERT INTO customers
         (id, restaurant_id, name, phone, birthdate, consent_lgpd)
         VALUES ($1,$2,$3,$4,$5,$6)
         RETURNING id, birthdate`,
        [
          uuidv4(),
          restaurant_id,
          name,
          phoneAtualizado,
          birthdate,
          consent_lgpd,
        ]
      );

      customer_id = newCustomer.rows[0].id;

      console.log("[customers] cliente criado", {
        customerId: customer_id,
        restaurantSlug: restaurant_slug,
        savedBirthdate: newCustomer.rows[0].birthdate,
      });
    }

    return c.json({
      success: true,
      customer_id,
    });
  } catch (error: any) {
    console.error("[customers] erro ao criar cliente", {
      error: error?.message ?? error,
      stack: error?.stack ?? null,
    });
    return c.json({ error: "Erro ao criar cliente" }, 500);
  }
});

export default customers;
