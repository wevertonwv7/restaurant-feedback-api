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
        return c.json({ error: "Email Ã© obrigatÃ³rio" }, 400);
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
app.post("/create-checkout-session", async (c) => {
    const user = c.get("user");
    const { plan } = await c.req.json();
    console.log("[stripe:checkout] iniciando create-checkout-session", {
        userId: user?.id,
        restaurantId: user?.restaurant_id,
        requestedPlan: plan,
    });
    if (!plan) {
        return c.json({ error: "Plano Ã© obrigatÃ³rio" }, 400);
    }
    const result = await client_1.pool.query(`SELECT r.stripe_customer_id, u.email
    FROM restaurants r
    JOIN users u ON u.restaurant_id = r.id
    WHERE r.id = $1
    LIMIT 1`, [user.restaurant_id]);
    if (result.rows.length === 0) {
        console.error("[stripe:checkout] restaurante não encontrado para checkout", {
            userId: user?.id,
            restaurantId: user?.restaurant_id,
        });
        return c.json({ error: "Restaurante nÃ£o encontrado" }, 404);
    }
    let customerId = result.rows[0].stripe_customer_id;
    const email = result.rows[0].email;
    if (!customerId) {
        console.log("[stripe:checkout] criando customer Stripe", {
            restaurantId: user.restaurant_id,
            email,
        });
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
    console.log("[stripe:checkout] preparando sessão Stripe", {
        customerId,
        requestedPlan: plan,
        priceId,
    });
    if (!priceId) {
        console.error("[stripe:checkout] priceId não configurado", {
            requestedPlan: plan,
            priceId,
        });
        return c.json({ error: "Price do plano nÃ£o configurado" }, 500);
    }
    const metadata = {
        userId: user.id,
        restaurant_id: user.restaurant_id,
        requested_plan: plan,
    };
    console.log("[stripe:checkout] metadata enviada para Stripe", metadata);
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
        success_url: "https://feedbacks-flow-dev.netlify.app/checkout/success",
        cancel_url: "https://feedbacks-flow-dev.netlify.app/checkout/cancel",
        metadata,
    });
    console.log("[stripe:checkout] sessão criada", {
        sessionId: session.id,
        customerId,
        subscription: session.subscription ?? null,
        metadata: session.metadata ?? null,
        url: session.url,
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
        return c.json({ error: "Restaurante nÃ£o encontrado" }, 404);
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
            message: "A assinatura jÃ¡ estava cancelada",
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
            message: "Cancelamento agendado para o fim do perÃ­odo",
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
