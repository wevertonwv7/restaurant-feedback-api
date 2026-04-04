import { Hono } from "hono";

import { pool } from "../db/client";
import { stripe } from "../lib/stripe";
import { authMiddleware } from "../middleware/auth";
import { createRestaurantCheckoutSession } from "../modules/stripe/checkout";
import type { Variables } from "../types/hono";

const app = new Hono<{ Variables: Variables }>();

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
  });
  const checkoutResult = await createRestaurantCheckoutSession({
    restaurantId: user.restaurant_id,
    userId: user.id,
    requestedPlan,
  });

  if ("error" in checkoutResult) {
    console.error("[stripe:checkout] erro ao criar sessao", {
      userId: user?.id,
      restaurantId: user?.restaurant_id,
      requestedPlan,
      error: checkoutResult.error,
    });

    return c.json({ error: checkoutResult.error }, checkoutResult.status);
  }

  console.log("[stripe:checkout] metadata enviada para Stripe", checkoutResult.metadata);

  console.log("[stripe:checkout] sessao criada", {
    sessionId: checkoutResult.session.id,
    customerId: checkoutResult.customerId,
    subscription: checkoutResult.session.subscription ?? null,
    metadata: checkoutResult.session.metadata ?? null,
    url: checkoutResult.session.url,
  });

  return c.json({ url: checkoutResult.session.url });
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
