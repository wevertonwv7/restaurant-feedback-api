import { Hono } from "hono";
import { stripe } from "../lib/stripe";
import { pool } from "../db/client";

const app = new Hono();

app.post("/create-customer", async (c) => {
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


app.post("/create-subscription", async (c) => {
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
        price: "prod_UBV751yfdqAmXb", // 🔥 seu price_id
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

  return c.json({
    subscriptionId: subscription.id,
    clientSecret:
      subscription.latest_invoice?.payment_intent?.client_secret,
  });
});

export default app;