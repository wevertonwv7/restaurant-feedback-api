"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const hono_1 = require("hono");
const cors_1 = require("hono/cors");
const node_server_1 = require("@hono/node-server");
const auth_1 = __importDefault(require("./routes/auth"));
const feedback_1 = __importDefault(require("./routes/feedback"));
const feedbacks_1 = __importDefault(require("./routes/feedbacks"));
const birthdays_1 = __importDefault(require("./routes/birthdays"));
const me_1 = __importDefault(require("./routes/me"));
const restaurants_1 = __importDefault(require("./routes/restaurants"));
const customers_1 = __importDefault(require("./routes/customers"));
const metrics_1 = __importDefault(require("./routes/metrics"));
const attendants_1 = __importDefault(require("./routes/attendants"));
const attendant_ratings_1 = __importDefault(require("./routes/attendant-ratings"));
const reports_1 = __importDefault(require("./routes/reports"));
const whatsapp_1 = __importDefault(require("./routes/whatsapp"));
const whatsappSender_1 = require("./workers/whatsappSender");
const campaigns_1 = __importDefault(require("./routes/campaigns"));
const campaignWorker_1 = require("./workers/campaignWorker");
const billing_1 = __importDefault(require("./routes/billing"));
const webhook_1 = __importDefault(require("./routes/webhook"));
const app = new hono_1.Hono();
app.use((0, cors_1.cors)({
    origin: ["https://savor-spot-score.lovable.app"],
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
}));
app.get("/", (c) => {
    return c.json({ message: "API funcionando 🚀" });
});
console.log("DATABASE_URL:", process.env.DATABASE_URL);
app.route("/api/auth", auth_1.default);
app.route("/api/feedback", feedback_1.default);
app.route("/api/feedbacks", feedbacks_1.default);
app.route("/api/birthdays", birthdays_1.default);
app.route("/api/me", me_1.default);
app.route("/api/restaurant", restaurants_1.default);
app.route("/api/customers", customers_1.default);
app.route("/api/metrics", metrics_1.default);
app.route("/api/attendants", attendants_1.default);
app.route("/api/attendant-ratings", attendant_ratings_1.default);
app.route("/api/reports", reports_1.default);
app.route("/api/whatsapp", whatsapp_1.default);
app.route("/api/campaigns", campaigns_1.default);
app.route("/api/billing", billing_1.default);
app.route("/api/webhook", webhook_1.default);
// 🚀 inicia worker sem quebrar o server
(0, whatsappSender_1.whatsappWorker)().catch((err) => {
    console.error("Erro no worker:", err);
});
// 🚀 inicia worker birthdayWorker sem quebrar o server
// birthdayWorker().catch((err) => {
// console.error("Erro no birthday worker:", err);
//});
// 🚀 inicia worker sem quebrar o server
(0, campaignWorker_1.campaignWorker)().catch(console.error);
const port = Number(process.env.PORT) || 3000;
console.log(`Servidor rodando em http://localhost:${port}`);
(0, node_server_1.serve)({
    fetch: app.fetch,
    port: port,
});
