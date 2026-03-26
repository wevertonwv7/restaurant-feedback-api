"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hono_1 = require("hono");
const stripe_1 = require("../lib/stripe");
const client_1 = require("../db/client");
const app = new hono_1.Hono();
async function syncSubscriptionStatus(subscription) {
    const subscriptionStatus = subscription.cancel_at_period_end
        ? "cancel_at_period_end"
        : subscription.status;
    await client_1.pool.query(`
    UPDATE restaurants
    SET stripe_subscription_id = $1,
        subscription_status = $2,
        plan = CASE
          WHEN $2 = 'canceled' THEN 'basic'
          ELSE plan
        END
    WHERE stripe_customer_id = $3
    `, [subscription.id, subscriptionStatus, String(subscription.customer)]);
}
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
        WHERE stripe_customer_id = $1
      `, [String(invoice.customer)]);
            break;
        case "invoice.payment_failed":
            const failed = event.data.object;
            await client_1.pool.query(`
        UPDATE restaurants
        SET subscription_status = 'past_due'
        WHERE stripe_customer_id = $1
      `, [String(failed.customer)]);
            break;
        case "customer.subscription.updated":
            await syncSubscriptionStatus(event.data.object);
            break;
        case "customer.subscription.deleted":
            await syncSubscriptionStatus(event.data.object);
            break;
    }
    return c.text("ok");
});
exports.default = app;
