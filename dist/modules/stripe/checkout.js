"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRestaurantCheckoutSession = createRestaurantCheckoutSession;
const client_1 = require("../../db/client");
const stripe_1 = require("../../lib/stripe");
const STRIPE_PRO_PRICE_ID = process.env.STRIPE_PRICE_PRO;
const STRIPE_PLAN = "pro";
async function createRestaurantCheckoutSession(params) {
    const result = await client_1.pool.query(`
    SELECT
      r.id,
      r.stripe_customer_id,
      u.id AS user_id,
      u.email
    FROM restaurants r
    JOIN users u ON u.restaurant_id = r.id
    WHERE r.id = $1
    ORDER BY
      CASE WHEN u.role = 'owner' THEN 0 ELSE 1 END,
      u.created_at ASC
    LIMIT 1
    `, [params.restaurantId]);
    if (result.rows.length === 0) {
        return {
            error: "Restaurante nao encontrado",
            status: 404,
        };
    }
    let customerId = result.rows[0].stripe_customer_id;
    const email = result.rows[0].email;
    const effectiveUserId = params.userId || result.rows[0].user_id;
    if (!STRIPE_PRO_PRICE_ID) {
        return {
            error: "Preco do plano pro nao configurado",
            status: 500,
        };
    }
    if (!email) {
        return {
            error: "Email do restaurante nao encontrado",
            status: 400,
        };
    }
    if (!customerId) {
        const customer = await stripe_1.stripe.customers.create({ email });
        customerId = customer.id;
        await client_1.pool.query(`
      UPDATE restaurants
      SET stripe_customer_id = $1
      WHERE id = $2
      `, [customerId, params.restaurantId]);
    }
    const metadata = {
        userId: effectiveUserId,
        restaurant_id: params.restaurantId,
        requested_plan: STRIPE_PLAN,
    };
    const session = await stripe_1.stripe.checkout.sessions.create({
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
    return {
        status: 200,
        session,
        metadata,
        customerId,
        requestedPlan: params.requestedPlan ?? null,
        effectivePlan: STRIPE_PLAN,
    };
}
