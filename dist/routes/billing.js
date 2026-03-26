"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hono_1 = require("hono");
const stripe_1 = require("../lib/stripe");
const client_1 = require("../db/client");
const auth_1 = require("../middleware/auth");
const app = new hono_1.Hono();
app.use("*", auth_1.authMiddleware);
const STRIPE_PRICE_IDS = {
    basic: process.env.STRIPE_PRICE_BASIC,
    pro: process.env.STRIPE_PRICE_PRO,
    premium: process.env.STRIPE_PRICE_PREMIUM,
};
app.post("/create-customer", async (c) => {
    const user = c.get("user");
    const { email } = await c.req.json();
    if (!email) {
        return c.json({ error: "Email é obrigatório" }, 400);
    }
    const customer = await stripe_1.stripe.customers.create({
        email,
    });
    await client_1.pool.query(`
    UPDATE restaurants
    SET stripe_customer_id = $1
    WHERE id = $2
    `, [customer.id, user.restaurant_id]);
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
    const user = c.get("user");
    const { plan } = await c.req.json();
    if (!plan) {
        return c.json({ error: "Plano é obrigatório" }, 400);
    }
    const result = await client_1.pool.query(`SELECT r.stripe_customer_id, u.email
    FROM restaurants r
    JOIN users u ON u.restaurant_id = r.id
    WHERE r.id = $1
    LIMIT 1`, [user.restaurant_id]);
    if (result.rows.length === 0) {
        return c.json({ error: "Restaurante não encontrado" }, 404);
    }
    let customerId = result.rows[0].stripe_customer_id;
    const email = result.rows[0].email;
    // Se não tiver customer, cria um
    if (!customerId) {
        const customer = await stripe_1.stripe.customers.create({
            email,
        });
        customerId = customer.id;
        await client_1.pool.query(`
      UPDATE restaurants
      SET stripe_customer_id = $1
      WHERE id = $2
      `, [customerId, user.restaurant_id]);
    }
    const priceId = STRIPE_PRICE_IDS[plan];
    if (!priceId) {
        return c.json({ error: "Price do plano não configurado" }, 500);
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
        metadata: {
            restaurant_id: user.restaurant_id,
            requested_plan: plan,
        },
    });
    return c.json({ url: session.url });
});
app.post("/cancel-subscription", async (c) => {
    const user = c.get("user");
    const body = await c.req.json().catch(() => ({}));
    const cancelAtPeriodEnd = body.cancelAtPeriodEnd !== false;
    const result = await client_1.pool.query(`SELECT stripe_subscription_id
     FROM restaurants
     WHERE id = $1`, [user.restaurant_id]);
    if (result.rows.length === 0) {
        return c.json({ error: "Restaurante não encontrado" }, 404);
    }
    const subscriptionId = result.rows[0].stripe_subscription_id;
    if (!subscriptionId) {
        return c.json({ error: "Nenhuma assinatura ativa encontrada" }, 404);
    }
    const currentSubscription = await stripe_1.stripe.subscriptions.retrieve(subscriptionId);
    if (currentSubscription.status === "canceled") {
        await client_1.pool.query(`
      UPDATE restaurants
      SET subscription_status = 'canceled',
          plan = 'basic'
      WHERE id = $1
      `, [user.restaurant_id]);
        return c.json({
            message: "A assinatura já estava cancelada",
            subscriptionId,
            status: "canceled",
        });
    }
    if (cancelAtPeriodEnd) {
        const updatedSubscription = await stripe_1.stripe.subscriptions.update(subscriptionId, {
            cancel_at_period_end: true,
        });
        await client_1.pool.query(`
      UPDATE restaurants
      SET subscription_status = $1
      WHERE id = $2
      `, [updatedSubscription.cancel_at_period_end ? "cancel_at_period_end" : updatedSubscription.status, user.restaurant_id]);
        return c.json({
            message: "Cancelamento agendado para o fim do período",
            subscriptionId: updatedSubscription.id,
            status: updatedSubscription.status,
            cancelAtPeriodEnd: updatedSubscription.cancel_at_period_end,
            currentPeriodEnd: updatedSubscription.items.data[0]?.current_period_end ?? null,
        });
    }
    const canceledSubscription = await stripe_1.stripe.subscriptions.cancel(subscriptionId);
    await client_1.pool.query(`
    UPDATE restaurants
    SET subscription_status = 'canceled',
        plan = 'basic'
    WHERE id = $1
    `, [user.restaurant_id]);
    return c.json({
        message: "Assinatura cancelada com sucesso",
        subscriptionId: canceledSubscription.id,
        status: canceledSubscription.status,
        cancelAtPeriodEnd: canceledSubscription.cancel_at_period_end,
    });
});
app.get("/ping", (c) => {
    return c.json({ ok: true });
});
exports.default = app;
