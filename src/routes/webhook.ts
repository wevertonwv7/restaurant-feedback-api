import { Hono } from "hono";
import { stripe } from "../lib/stripe";
import { pool } from "../db/client";
import Stripe from "stripe";

const app = new Hono();

async function syncSubscriptionStatus(subscription: Stripe.Subscription) {
  const subscriptionStatus = subscription.cancel_at_period_end
    ? "cancel_at_period_end"
    : subscription.status;

  await pool.query(
    `
    UPDATE restaurants
    SET stripe_subscription_id = $1,
        subscription_status = $2,
        plan = CASE
          WHEN $2 = 'canceled' THEN 'basic'
          ELSE plan
        END
    WHERE stripe_customer_id = $3
    `,
    [subscription.id, subscriptionStatus, String(subscription.customer)]
  );
}

app.post("/", async (c) => {
  const sig = c.req.header("stripe-signature");
  const body = await c.req.text();

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig!,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    return c.text("Erro webhook", 400);
  }

  switch (event.type) {
    case "invoice.paid":
      const invoice = event.data.object;

      await pool.query(
        `
        UPDATE restaurants
        SET subscription_status = 'active'
        WHERE stripe_customer_id = $1
      `,
        [String(invoice.customer)]
      );
      break;

    case "invoice.payment_failed":
      const failed = event.data.object;

      await pool.query(
        `
        UPDATE restaurants
        SET subscription_status = 'past_due'
        WHERE stripe_customer_id = $1
      `,
        [String(failed.customer)]
      );
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

export default app;
