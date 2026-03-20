"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hono_1 = require("hono");
const stripe_1 = require("../lib/stripe");
const client_1 = require("../db/client");
const app = new hono_1.Hono();
app.post("/", async (c) => {
    const sig = c.req.header("stripe-signature");
    const body = await c.req.text();
    let event;
    try {
        event = stripe_1.stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET);
    }
    catch (err) {
        return c.text("Webhook error", 400);
    }
    // 🎯 PAGAMENTO APROVADO
    if (event.type === "checkout.session.completed") {
        const session = event.data.object;
        const restaurantId = session.metadata.restaurantId;
        // 🔥 ATIVA PLANO NO BANCO
        await client_1.pool.query(`
      UPDATE restaurants
      SET plan = 'pro'
      WHERE id = $1
      `, [restaurantId]);
    }
    return c.text("ok");
});
exports.default = app;
