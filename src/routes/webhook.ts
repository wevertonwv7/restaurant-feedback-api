import { Hono } from "hono";
import { stripe } from "../lib/stripe";
import { pool } from "../db/client";

const app = new Hono();

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
  }

  return c.text("ok");
});

export default app;
