"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hono_1 = require("hono");
const stripe_1 = require("../lib/stripe");
const client_1 = require("../db/client");
const app = new hono_1.Hono();
app.post("/create-customer", async (c) => {
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
/* app.post("/create-subscription", authMiddleware, async (c) => {
  const { restaurantId } = await c.req.json();

  const result = await pool.query(
    `SELECT stripe_customer_id FROM restaurants WHERE id = $1`,
    [restaurantId]
  );

  const customerId = result.rows[0].stripe_customer_id;

  const subscription = await stripe.subscriptions.create({
    customer: customerId,
    items: [
      {
        price: "price_1TD87gCtpNRgw1mVQGwDcKxK",
      },
    ],
    payment_behavior: "default_incomplete",
    expand: ["latest_invoice.payment_intent"],
  });

  await pool.query(
    `
    UPDATE restaurants
    SET stripe_subscription_id = $1,
        subscription_status = $2
    WHERE id = $3
    `,
    [subscription.id, subscription.status, restaurantId]
  );
const invoice = subscription.latest_invoice as Stripe.Invoice & {
  payment_intent?: Stripe.PaymentIntent;
};

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
});*/
app.post("/create-checkout-session", async (c) => {
    const { restaurantId, plan } = await c.req.json();
    const result = await client_1.pool.query(`SELECT r.stripe_customer_id, u.email
    FROM restaurants r
    JOIN users u ON u.restaurant_id = r.id
    WHERE r.id = $1
    LIMIT 1`, [restaurantId]);
    let customerId = result.rows[0].stripe_customer_id;
    const email = result.rows[0].email;
    // 🔥 se não tiver customer, cria um
    if (!customerId) {
        const customer = await stripe_1.stripe.customers.create({
            email: email,
        });
        customerId = customer.id;
        await client_1.pool.query(`
    UPDATE restaurants
    SET stripe_customer_id = $1
    WHERE id = $2
    `, [customerId, restaurantId]);
    }
    const PLANS = {
        basic: "price_1TD87gCtpNRgw1mVQGwDcKxK",
        pro: "price_1TDXRuCtpNRgw1mVouWYZyvK",
        premium: "price_1TDXShCtpNRgw1mValNcRBRO",
    };
    const priceId = PLANS[plan];
    if (!priceId) {
        return c.json({ error: "Plano inválido" }, 400);
    }
    const session = await stripe_1.stripe.checkout.sessions.create({
        customer: customerId,
        payment_method_types: ["card"],
        mode: "subscription",
        line_items: [
            {
                price: priceId,
                quantity: 1,
            },
        ],
        success_url: "https://savor-spot-score.lovable.app/checkout/success",
        cancel_url: "https://savor-spot-score.lovable.app/checkout/cancel",
    });
    return c.json({ url: session.url });
});
app.get("/ping", (c) => {
    return c.json({ ok: true });
});
exports.default = app;
