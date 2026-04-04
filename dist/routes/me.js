"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hono_1 = require("hono");
const client_1 = require("../db/client");
const auth_1 = require("../middleware/auth");
const me = new hono_1.Hono();
me.get("/", auth_1.authMiddleware, async (c) => {
    const user = c.get("user"); // vem do JWT
    // query para pegar o plano do restaurante
    const result = await client_1.pool.query(`SELECT r.plan,
    r.slug AS restaurant_slug,
    r.subscription_status,
    r.stripe_subscription_id,
    u.email,
    u.name,
    u.role,
    r.name AS restaurant_name
  FROM restaurants r 
  JOIN users u
  on r.ID = u.restaurant_id
  WHERE r.id = $1`, [user.restaurant_id]);
    const restaurant = result.rows[0];
    return c.json({
        user: {
            ...user,
            name: restaurant?.name ?? null,
            role: restaurant?.role ?? null,
            plan: restaurant?.plan ?? null,
            restaurant_slug: restaurant?.restaurant_slug,
            restaurant_id: user.restaurant_id,
            restaurant_name: restaurant.restaurant_name,
            email: restaurant.email,
            subscription_status: restaurant?.subscription_status || null,
            stripe_subscription_id: restaurant?.stripe_subscription_id || null,
        }
    });
});
exports.default = me;
