import { Hono } from "hono";
import Stripe from "stripe";

import { stripe, stripeWebhookSecret } from "../lib/stripe";
import { pool } from "../db/client";

const app = new Hono();
const VALID_PLANS = new Set(["basic", "pro", "premium"]);

function getStripeId(
  value:
    | string
    | Stripe.Customer
    | Stripe.Subscription
    | Stripe.DeletedCustomer
    | { id: string }
    | null
    | undefined
) {
  if (!value) {
    return null;
  }

  return typeof value === "string" ? value : value.id;
}

async function syncSubscriptionStatus(subscription: Stripe.Subscription) {
  const subscriptionStatus = subscription.cancel_at_period_end
    ? "cancel_at_period_end"
    : subscription.status;

  const customerId = getStripeId(subscription.customer);

  if (!customerId) {
    console.error("[stripe:webhook] customer.subscription sem customer válido", {
      subscriptionId: subscription.id,
      status: subscriptionStatus,
    });
    return;
  }

  console.log("[stripe:webhook] syncSubscriptionStatus", {
    subscriptionId: subscription.id,
    customerId,
    subscriptionStatus,
  });

  const result = await pool.query(
    `
    UPDATE restaurants
    SET stripe_subscription_id = $1,
        stripe_customer_id = $2,
        subscription_status = $3,
        plan = CASE
          WHEN $3 = 'canceled' THEN null
          ELSE plan
        END
    WHERE stripe_customer_id = $2
    `,
    [subscription.id, customerId, subscriptionStatus]
  );

  console.log("[stripe:webhook] syncSubscriptionStatus resultado", {
    subscriptionId: subscription.id,
    customerId,
    updatedRows: result.rowCount,
  });
}

async function saveCheckoutCompletion(session: Stripe.Checkout.Session) {
  console.log("[stripe:webhook] checkout.session.completed payload:", JSON.stringify(session));

  const subscriptionId = getStripeId(session.subscription as string | Stripe.Subscription | null | undefined);
  const customerId = getStripeId(session.customer as string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined);
  const userId = session.metadata?.userId;
  const requestedPlan = session.metadata?.requested_plan;
  const normalizedPlan =
    requestedPlan && VALID_PLANS.has(requestedPlan) ? requestedPlan : null;

  console.log("[stripe:webhook] checkout.session.completed campos extraídos", {
    sessionId: session.id,
    subscriptionId,
    customerId,
    userId,
    requestedPlan,
    normalizedPlan,
  });

  if (!userId || !subscriptionId || !customerId) {
    console.error("[stripe:webhook] checkout.session.completed com campos ausentes", {
      sessionId: session.id,
      userId,
      subscriptionId,
      customerId,
      metadata: session.metadata ?? null,
    });

    if (!session.subscription) {
      console.error("[stripe:webhook] session.subscription veio null/undefined", {
        sessionId: session.id,
      });
    }

    if (!session.customer) {
      console.error("[stripe:webhook] session.customer veio null/undefined", {
        sessionId: session.id,
      });
    }

    if (!userId) {
      console.error("[stripe:webhook] metadata.userId não foi enviado na checkout session", {
        sessionId: session.id,
      });
    }

    return;
  }

  console.log("[stripe:webhook] subscriptionId antes de salvar:", subscriptionId);

  if (!normalizedPlan) {
    console.error("[stripe:webhook] metadata.requested_plan ausente ou inválido", {
      sessionId: session.id,
      requestedPlan,
      metadata: session.metadata ?? null,
    });
  }

  const restaurantResult = await pool.query(
    `
    SELECT r.id, r.plan, r.stripe_subscription_id, r.stripe_customer_id, r.subscription_status
    FROM restaurants r
    JOIN users u ON u.restaurant_id = r.id
    WHERE u.id = $1
    LIMIT 1
    `,
    [userId]
  );

  if (restaurantResult.rows.length === 0) {
    console.error("[stripe:webhook] nenhum restaurante encontrado para userId", {
      userId,
      sessionId: session.id,
    });
    return;
  }

  const restaurant = restaurantResult.rows[0] as {
    id: string;
    plan: string | null;
    stripe_subscription_id: string | null;
    stripe_customer_id: string | null;
    subscription_status: string | null;
  };

  console.log("[stripe:webhook] restaurante localizado para checkout", {
    restaurantId: restaurant.id,
    currentPlan: restaurant.plan,
    currentSubscriptionId: restaurant.stripe_subscription_id,
    currentCustomerId: restaurant.stripe_customer_id,
    currentSubscriptionStatus: restaurant.subscription_status,
    userId,
  });

  const alreadySaved =
    restaurant.stripe_subscription_id === subscriptionId &&
    restaurant.stripe_customer_id === customerId &&
    restaurant.subscription_status === "active" &&
    (!normalizedPlan || restaurant.plan === normalizedPlan);

  if (alreadySaved) {
    console.log("[stripe:webhook] evento idempotente, assinatura já estava salva", {
      restaurantId: restaurant.id,
      userId,
      subscriptionId,
      customerId,
    });
    return;
  }

  const updateResult = await pool.query(
    `
    UPDATE restaurants
    SET stripe_subscription_id = $1,
        stripe_customer_id = $2,
        subscription_status = 'active',
        plan = COALESCE($3, plan)
    WHERE id = $4
    `,
    [subscriptionId, customerId, normalizedPlan, restaurant.id]
  );

  const updatedRestaurantResult = await pool.query(
    `
    SELECT id, plan, stripe_subscription_id, stripe_customer_id, subscription_status
    FROM restaurants
    WHERE id = $1
    `,
    [restaurant.id]
  );

  console.log("[stripe:webhook] checkout.session.completed salvo no banco", {
    restaurantId: restaurant.id,
    userId,
    subscriptionId,
    customerId,
    plan: normalizedPlan,
    updatedRows: updateResult.rowCount,
    restaurantAfterUpdate: updatedRestaurantResult.rows[0] ?? null,
  });
}

app.post("/", async (c) => {
  const signature = c.req.header("stripe-signature");
  const rawBody = await c.req.text();

  if (!signature || !stripeWebhookSecret) {
    console.error("[stripe:webhook] assinatura ou secret ausente", {
      hasSignature: Boolean(signature),
      hasWebhookSecret: Boolean(stripeWebhookSecret),
    });
    return c.text("Webhook signature validation failed", 400);
  }

  let event: Stripe.Event;

  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, stripeWebhookSecret);
  } catch (error) {
    console.error("[stripe:webhook] falha ao validar assinatura", error);
    return c.text("Webhook signature validation failed", 400);
  }

  console.log("[stripe:webhook] event.type:", event.type);

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await saveCheckoutCompletion(event.data.object as Stripe.Checkout.Session);
        break;

      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = getStripeId(invoice.customer as string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined);
        const invoiceSubscription = (invoice as Stripe.Invoice & {
          subscription?: string | Stripe.Subscription | null;
        }).subscription;

        console.log("[stripe:webhook] invoice.paid payload", {
          invoiceId: invoice.id,
          customerId,
          subscriptionId: getStripeId(invoiceSubscription),
          billingReason: invoice.billing_reason,
        });

        if (!customerId) {
          console.error("[stripe:webhook] invoice.paid sem customerId", {
            invoiceId: invoice.id,
          });
          break;
        }

        const result = await pool.query(
          `
          UPDATE restaurants
          SET subscription_status = 'active'
          WHERE stripe_customer_id = $1
          `,
          [customerId]
        );

        console.log("[stripe:webhook] invoice.paid update resultado", {
          invoiceId: invoice.id,
          customerId,
          updatedRows: result.rowCount,
        });
        break;
      }

      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const customerId = getStripeId(invoice.customer as string | Stripe.Customer | Stripe.DeletedCustomer | null | undefined);

        if (!customerId) {
          console.error("[stripe:webhook] invoice.payment_failed sem customerId", {
            invoiceId: invoice.id,
          });
          break;
        }

        await pool.query(
          `
          UPDATE restaurants
          SET subscription_status = 'past_due'
          WHERE stripe_customer_id = $1
          `,
          [customerId]
        );
        break;
      }

      case "customer.subscription.updated":
        await syncSubscriptionStatus(event.data.object as Stripe.Subscription);
        break;

      case "customer.subscription.deleted":
        await syncSubscriptionStatus(event.data.object as Stripe.Subscription);
        break;

      default:
        console.log("[stripe:webhook] evento ignorado", { eventType: event.type });
        break;
    }
  } catch (error) {
    console.error("[stripe:webhook] erro ao processar evento", {
      eventType: event.type,
      error,
    });
  }

  return c.json({ received: true }, 200);
});

export default app;
