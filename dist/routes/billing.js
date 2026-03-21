"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hono_1 = require("hono");
const stripe_1 = require("../lib/stripe");
const client_1 = require("../db/client");
const auth_1 = require("../middleware/auth");
const app = new hono_1.Hono();
app.post("/create-customer", auth_1.authMiddleware, async (c) => {
    const { restaurantId, email } = await c.req.json();
    const customer = await stripe_1.stripe.customers.create({
        email,
    });
    await client_1.pool.query(`
    UPDATE restaurants
    SET stripe_customer_id = $1
    WHERE id = $2
    `, [customer.id, restaurantId]);
    return c.json(customer);
});
app.post("/create-subscription", auth_1.authMiddleware, async (c) => {
    const { restaurantId } = await c.req.json();
    const result = await client_1.pool.query(`SELECT stripe_customer_id FROM restaurants WHERE id = $1`, [restaurantId]);
    const customerId = result.rows[0].stripe_customer_id;
    const subscription = await stripe_1.stripe.subscriptions.create({
        customer: customerId,
        items: [
            {
                price: "price_1TD87gCtpNRgw1mVQGwDcKxK",
            },
        ],
        payment_behavior: "default_incomplete",
        expand: ["latest_invoice.payment_intent"],
    });
    await client_1.pool.query(`
    UPDATE restaurants
    SET stripe_subscription_id = $1,
        subscription_status = $2
    WHERE id = $3
    `, [subscription.id, subscription.status, restaurantId]);
    const invoice = subscription.latest_invoice;
    if (!invoice.payment_intent) {
        return c.json({
            error: "PaymentIntent não foi criado",
            subscriptionId: subscription.id,
        }, 400);
    }
    return c.json({
        subscriptionId: subscription.id,
        clientSecret: invoice.payment_intent.client_secret,
    });
});
app.get("/ping", (c) => {
    return c.json({ ok: true });
});
exports.default = app;
