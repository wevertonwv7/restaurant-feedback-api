"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hono_1 = require("hono");
const client_1 = require("../db/client");
const auth_1 = require("../middleware/auth");
const app = new hono_1.Hono();
function normalizePhones(value) {
    if (!Array.isArray(value)) {
        return [];
    }
    return value
        .map((phone) => String(phone ?? "").replace(/\D/g, "").trim())
        .filter(Boolean);
}
app.use("*", auth_1.authMiddleware);
app.get("/", async (c) => {
    const user = c.get("user");
    const result = await client_1.pool.query(`
    SELECT restaurant_id, detractor_alert_enabled, detractor_alert_phones, created_at, updated_at
    FROM restaurant_alert_settings
    WHERE restaurant_id = $1
    LIMIT 1
    `, [user.restaurant_id]);
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
    const detractorAlertEnabled = typeof body.detractor_alert_enabled === "boolean"
        ? body.detractor_alert_enabled
        : true;
    const detractorAlertPhones = normalizePhones(body.detractor_alert_phones);
    const result = await client_1.pool.query(`
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
    `, [
        user.restaurant_id,
        detractorAlertEnabled,
        JSON.stringify(detractorAlertPhones),
    ]);
    return c.json(result.rows[0]);
});
exports.default = app;
