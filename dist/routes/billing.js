"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const hono_1 = require("hono");
const stripe_1 = require("../lib/stripe");
const app = new hono_1.Hono();
app.post("/checkout", async (c) => {
    const body = await c.req.json();
    const { restaurantId, email } = body;
    const session = await stripe_1.stripe.checkout.sessions.create({
        mode: "subscription",
        payment_method_types: ["card"],
        customer_email: email,
        line_items: [
            {
                price: "price_123abc456", // 🔥 seu price_id
                quantity: 1,
            },
        ],
        success_url: "http://localhost:5173/sucesso",
        cancel_url: "http://localhost:5173/cancelado",
        metadata: {
            restaurantId,
        },
    });
    return c.json({ url: session.url });
});
exports.default = app;
