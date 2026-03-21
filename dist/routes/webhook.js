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
        return c.text("Erro webhook", 400);
    }
    switch (event.type) {
        case "invoice.paid":
            const invoice = event.data.object;
            await client_1.pool.query(`
        UPDATE restaurants
        SET subscription_status = 'active'
        WHERE stripe_customer_id = '${invoice.customer}'
      `);
            break;
        case "invoice.payment_failed":
            const failed = event.data.object;
            await client_1.pool.query(`
        UPDATE restaurants
        SET subscription_status = 'past_due'
        WHERE stripe_customer_id = '${failed.customer}'
      `);
            break;
    }
    return c.text("ok");
});
exports.default = app;
