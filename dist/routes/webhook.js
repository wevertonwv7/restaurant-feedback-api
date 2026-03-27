"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hono_1 = require("hono");
const stripe_1 = require("../lib/stripe");
const client_1 = require("../db/client");
const app = new hono_1.Hono();
const VALID_PLANS = new Set(["basic", "pro", "premium"]);
function getStripeId(value) {
    if (!value) {
        return null;
    }
    return typeof value === "string" ? value : value.id;
}
async function syncSubscriptionStatus(subscription) {
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
    await client_1.pool.query(`
    UPDATE restaurants
    SET stripe_subscription_id = $1,
        stripe_customer_id = $2,
        subscription_status = $3,
        plan = CASE
          WHEN $3 = 'canceled' THEN 'basic'
          ELSE plan
        END
    WHERE stripe_customer_id = $2
    `, [subscription.id, customerId, subscriptionStatus]);
}
async function saveCheckoutCompletion(session) {
    console.log("[stripe:webhook] checkout.session.completed payload:", JSON.stringify(session));
    const subscriptionId = getStripeId(session.subscription);
    const customerId = getStripeId(session.customer);
    const userId = session.metadata?.userId;
    const requestedPlan = session.metadata?.requested_plan;
    const normalizedPlan = requestedPlan && VALID_PLANS.has(requestedPlan) ? requestedPlan : null;
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
    const restaurantResult = await client_1.pool.query(`
    SELECT r.id, r.plan, r.stripe_subscription_id, r.stripe_customer_id, r.subscription_status
    FROM restaurants r
    JOIN users u ON u.restaurant_id = r.id
    WHERE u.id = $1
    LIMIT 1
    `, [userId]);
    if (restaurantResult.rows.length === 0) {
        console.error("[stripe:webhook] nenhum restaurante encontrado para userId", {
            userId,
            sessionId: session.id,
        });
        return;
    }
    const restaurant = restaurantResult.rows[0];
    const alreadySaved = restaurant.stripe_subscription_id === subscriptionId &&
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
    const updateResult = await client_1.pool.query(`
    UPDATE restaurants
    SET stripe_subscription_id = $1,
        stripe_customer_id = $2,
        subscription_status = 'active',
        plan = COALESCE($3, plan)
    WHERE id = $4
    `, [subscriptionId, customerId, normalizedPlan, restaurant.id]);
    console.log("[stripe:webhook] checkout.session.completed salvo no banco", {
        restaurantId: restaurant.id,
        userId,
        subscriptionId,
        customerId,
        plan: normalizedPlan,
        updatedRows: updateResult.rowCount,
    });
}
app.post("/", async (c) => {
    const signature = c.req.header("stripe-signature");
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    const rawBody = await c.req.text();
    if (!signature || !webhookSecret) {
        console.error("[stripe:webhook] assinatura ou secret ausente", {
            hasSignature: Boolean(signature),
            hasWebhookSecret: Boolean(webhookSecret),
        });
        return c.text("Webhook signature validation failed", 400);
    }
    let event;
    try {
        event = stripe_1.stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
    }
    catch (error) {
        console.error("[stripe:webhook] falha ao validar assinatura", error);
        return c.text("Webhook signature validation failed", 400);
    }
    console.log("[stripe:webhook] event.type:", event.type);
    try {
        switch (event.type) {
            case "checkout.session.completed":
                await saveCheckoutCompletion(event.data.object);
                break;
            case "invoice.paid": {
                const invoice = event.data.object;
                const customerId = getStripeId(invoice.customer);
                if (!customerId) {
                    console.error("[stripe:webhook] invoice.paid sem customerId", {
                        invoiceId: invoice.id,
                    });
                    break;
                }
                await client_1.pool.query(`
          UPDATE restaurants
          SET subscription_status = 'active'
          WHERE stripe_customer_id = $1
          `, [customerId]);
                break;
            }
            case "invoice.payment_failed": {
                const invoice = event.data.object;
                const customerId = getStripeId(invoice.customer);
                if (!customerId) {
                    console.error("[stripe:webhook] invoice.payment_failed sem customerId", {
                        invoiceId: invoice.id,
                    });
                    break;
                }
                await client_1.pool.query(`
          UPDATE restaurants
          SET subscription_status = 'past_due'
          WHERE stripe_customer_id = $1
          `, [customerId]);
                break;
            }
            case "customer.subscription.updated":
                await syncSubscriptionStatus(event.data.object);
                break;
            case "customer.subscription.deleted":
                await syncSubscriptionStatus(event.data.object);
                break;
            default:
                console.log("[stripe:webhook] evento ignorado", { eventType: event.type });
                break;
        }
    }
    catch (error) {
        console.error("[stripe:webhook] erro ao processar evento", {
            eventType: event.type,
            error,
        });
    }
    return c.json({ received: true }, 200);
});
exports.default = app;
