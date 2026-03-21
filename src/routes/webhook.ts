/* import { Hono } from "hono";
import { stripe } from "../lib/stripe";
import { pool } from "../db/client";

const app = new Hono();

app.post("/", async (c) => {
  const sig = c.req.header("stripe-signature")!;
  const body = await c.req.text();

  let event;

  try {
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!
    );
  } catch (err) {
    return c.text("Webhook error", 400);
  }

  // 🎯 PAGAMENTO APROVADO
  if (event.type === "checkout.session.completed") {
    const session = event.data.object as any;

    const restaurantId = session.metadata.restaurantId;

    // 🔥 ATIVA PLANO NO BANCO
    await pool.query(
      `
      UPDATE restaurants
      SET plan = 'pro'
      WHERE id = $1
      `,
      [restaurantId]
    );
  }

  return c.text("ok");
});

export default app; */