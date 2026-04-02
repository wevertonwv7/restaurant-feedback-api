import { Hono } from "hono";

import { pool } from "../db/client";
import { authMiddleware } from "../middleware/auth";
import type { Variables } from "../types/hono";

const app = new Hono<{ Variables: Variables }>();

function normalizePhones(value: unknown) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((phone) => String(phone ?? "").replace(/\D/g, "").trim())
    .filter(Boolean);
}

app.use("*", authMiddleware);

app.get("/", async (c) => {
  const user = c.get("user");

  const result = await pool.query(
    `
    SELECT restaurant_id, detractor_alert_enabled, detractor_alert_phones, created_at, updated_at
    FROM restaurant_alert_settings
    WHERE restaurant_id = $1
    LIMIT 1
    `,
    [user.restaurant_id]
  );

  if (result.rows.length === 0) {
    return c.json({
      restaurant_id: user.restaurant_id,
      detractor_alert_enabled: true,
      detractor_alert_phones: [],
    });
  }

  return c.json(result.rows[0]);
});

app.put("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json();

  const detractorAlertEnabled =
    typeof body.detractor_alert_enabled === "boolean"
      ? body.detractor_alert_enabled
      : true;

  const detractorAlertPhones = normalizePhones(body.detractor_alert_phones);

  const result = await pool.query(
    `
    INSERT INTO restaurant_alert_settings
      (restaurant_id, detractor_alert_enabled, detractor_alert_phones, created_at, updated_at)
    VALUES
      ($1, $2, $3::jsonb, NOW(), NOW())
    ON CONFLICT (restaurant_id)
    DO UPDATE SET
      detractor_alert_enabled = EXCLUDED.detractor_alert_enabled,
      detractor_alert_phones = EXCLUDED.detractor_alert_phones,
      updated_at = NOW()
    RETURNING restaurant_id, detractor_alert_enabled, detractor_alert_phones, created_at, updated_at
    `,
    [
      user.restaurant_id,
      detractorAlertEnabled,
      JSON.stringify(detractorAlertPhones),
    ]
  );

  return c.json(result.rows[0]);
});

export default app;
