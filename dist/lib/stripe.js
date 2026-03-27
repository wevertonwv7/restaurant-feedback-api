"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.stripeWebhookSecret = exports.stripe = void 0;
const stripe_1 = __importDefault(require("stripe"));
if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("STRIPE_SECRET_KEY nao definida");
}
exports.stripe = new stripe_1.default(process.env.STRIPE_SECRET_KEY, {
    apiVersion: "2026-02-25.clover",
});
exports.stripeWebhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
