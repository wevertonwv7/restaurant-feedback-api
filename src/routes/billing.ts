import { Hono } from "hono";
import { stripe } from "../lib/stripe";
import { pool } from "../db/client";
import Stripe from "stripe";
import { authMiddleware } from "../middleware/auth";


const app = new Hono();

app.post("/create-customer", authMiddleware, async (c) => {
  const { restaurantId, email } = await c.req.json();

  const customer = await stripe.customers.create({
    email,
  });

  await pool.query(
    `
    UPDATE restaurants
    SET stripe_customer_id = $1
    WHERE id = $2
    `,
    [customer.id, restaurantId]
  );

  return c.json(customer);
});


app.post("/create-subscription", authMiddleware, async (c) => {
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

  // ✅ CORREÇÃO DE TIPAGEM
 const invoice = subscription.latest_invoice as Stripe.Invoice & {
  payment_intent: Stripe.PaymentIntent;
};

return c.json({
  subscriptionId: subscription.id,
  clientSecret: invoice.payment_intent.client_secret,
});
});

export default app;