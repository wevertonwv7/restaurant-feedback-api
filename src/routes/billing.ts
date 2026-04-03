import { Hono } from "hono";

import { pool } from "../db/client";
import { stripe } from "../lib/stripe";
import { authMiddleware } from "../middleware/auth";
import type { Variables } from "../types/hono";

const app = new Hono<{ Variables: Variables }>();
const STRIPE_PRO_PRICE_ID = process.env.STRIPE_PRICE_PRO;
const STRIPE_PLAN = "pro";

app.use("*", authMiddleware);

app.post("/create-customer", async (c) => {
  const user = c.get("user");
  const { email } = await c.req.json();

  if (!email) {
    return c.json({ error: "Email e obrigatorio" }, 400);
  }

  const customer = await stripe.customers.create({
    email,
  });

  await pool.query(
    `
    UPDATE restaurants
    SET stripe_customer_id = $1
    WHERE id = $2
    `,
    [customer.id, user.restaurant_id]
  );

  return c.json(customer);
});

app.post("/create-checkout-session", async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => ({}));
  const requestedPlan = body?.plan ?? null;

  console.log("[stripe:checkout] iniciando create-checkout-session", {
    userId: user?.id,
    restaurantId: user?.restaurant_id,
    requestedPlan,
    effectivePlan: STRIPE_PLAN,
  });

  const result = await pool.query(
    `SELECT r.stripe_customer_id, u.email
    FROM restaurants r
    JOIN users u ON u.restaurant_id = r.id
    WHERE r.id = $1
    LIMIT 1`,
    [user.restaurant_id]
  );

  if (result.rows.length === 0) {
    console.error("[stripe:checkout] restaurante nao encontrado para checkout", {
      userId: user?.id,
      restaurantId: user?.restaurant_id,
    });
    return c.json({ error: "Restaurante nao encontrado" }, 404);
  }

  let customerId = result.rows[0].stripe_customer_id;
  const email = result.rows[0].email;

  if (!customerId) {
    console.log("[stripe:checkout] criando customer Stripe", {
      restaurantId: user.restaurant_id,
      email,
    });

    const customer = await stripe.customers.create({
      email,
    });

    customerId = customer.id;

    await pool.query(
      `
      UPDATE restaurants
      SET stripe_customer_id = $1
      WHERE id = $2
      `,
      [customerId, user.restaurant_id]
    );
  }

  console.log("[stripe:checkout] preparando sessao Stripe", {
    customerId,
    requestedPlan,
    effectivePlan: STRIPE_PLAN,
    priceId: STRIPE_PRO_PRICE_ID,
  });

  if (!STRIPE_PRO_PRICE_ID) {
    console.error("[stripe:checkout] STRIPE_PRICE_PRO nao configurado");
    return c.json({ error: "Preco do plano pro nao configurado" }, 500);
  }

  const metadata = {
    userId: user.id,
    restaurant_id: user.restaurant_id,
    requested_plan: STRIPE_PLAN,
  };

  console.log("[stripe:checkout] metadata enviada para Stripe", metadata);

  const session = await stripe.checkout.sessions.create({
    customer: customerId,
    payment_method_types: ["card"],
    mode: "subscription",
    line_items: [
      {
        price: STRIPE_PRO_PRICE_ID,
        quantity: 1,
      },
    ],
    success_url: "https://feedbacks-flow-dev.netlify.app/checkout/success",
    cancel_url: "https://feedbacks-flow-dev.netlify.app/checkout/cancel",
    metadata,
  });

  console.log("[stripe:checkout] sessao criada", {
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

  const result = await pool.query(
    `SELECT stripe_subscription_id
     FROM restaurants
     WHERE id = $1`,
    [user.restaurant_id]
  );

  if (result.rows.length === 0) {
    return c.json({ error: "Restaurante nao encontrado" }, 404);
  }

  const subscriptionId = result.rows[0].stripe_subscription_id as string | null;

  if (!subscriptionId) {
    return c.json({ error: "Nenhuma assinatura ativa encontrada" }, 404);
  }

  const currentSubscription = await stripe.subscriptions.retrieve(subscriptionId);

  if (currentSubscription.status === "canceled") {
    await pool.query(
      `
      UPDATE restaurants
      SET subscription_status = 'canceled',
          plan = null
      WHERE id = $1
      `,
      [user.restaurant_id]
    );

    return c.json({
      message: "A assinatura ja estava cancelada",
      subscriptionId,
      status: "canceled",
    });
  }

  if (cancelAtPeriodEnd) {
    const updatedSubscription = await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true,
    });

    await pool.query(
      `
      UPDATE restaurants
      SET subscription_status = $1
      WHERE id = $2
      `,
      [
        updatedSubscription.cancel_at_period_end
          ? "cancel_at_period_end"
          : updatedSubscription.status,
        user.restaurant_id,
      ]
    );

    return c.json({
      message: "Cancelamento agendado para o fim do periodo",
      subscriptionId: updatedSubscription.id,
      status: updatedSubscription.status,
      cancelAtPeriodEnd: updatedSubscription.cancel_at_period_end,
      currentPeriodEnd: updatedSubscription.items.data[0]?.current_period_end ?? null,
    });
  }

  const canceledSubscription = await stripe.subscriptions.cancel(subscriptionId);

  await pool.query(
    `
    UPDATE restaurants
    SET subscription_status = 'canceled',
        plan = null
    WHERE id = $1
    `,
    [user.restaurant_id]
  );

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

export default app;
