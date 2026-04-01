import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import type { Variables } from "./types/hono";

import auth from "./routes/auth";
import feedback from "./routes/feedback";
import feedbacks from "./routes/feedbacks";
import birthdays from "./routes/birthdays";
import me from "./routes/me";
import restaurant from "./routes/restaurants";
import customers from "./routes/customers";
import metrics from "./routes/metrics";
import attendants from "./routes/attendants";
import attendantRatings from "./routes/attendant-ratings"; 
import reports from "./routes/reports"; 
import whatsapp from "./routes/whatsapp";
import { whatsappWorker } from "./workers/whatsappSender";
import { birthdayWorker } from "./workers/birthdayWorker";
import { processCampaigns } from "./modules/whatsapp/campaigns"; 
import campaigns from "./routes/campaigns";
import { campaignWorker } from "./workers/campaignWorker";
import billing from "./routes/billing";
import webhook from "./routes/webhook";



const app = new Hono<{ Variables: Variables }>();



app.use(
  cors({
    origin: [
      "https://opiniofeedbacks.com"
    ],
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    credentials: true,
  })
);

app.get("/", (c) => {
  return c.json({ message: "API funcionando 🚀" });
});

app.route("/api/auth", auth);
app.route("/api/feedback", feedback);
app.route("/api/feedbacks", feedbacks);
app.route("/api/birthdays", birthdays);
app.route("/api/me", me);
app.route("/api/restaurant", restaurant);
app.route("/api/customers", customers);
app.route("/api/metrics", metrics);
app.route("/api/attendants", attendants);
app.route("/api/attendant-ratings", attendantRatings);
app.route("/api/reports", reports); 
app.route("/api/whatsapp", whatsapp);
app.route("/api/campaigns", campaigns);
app.route("/api/billing", billing);
app.route("/api/webhook", webhook);

// 🚀 inicia worker sem quebrar o server
whatsappWorker().catch((err) => {
  console.error("Erro no worker:", err);
});

// 🚀 inicia worker birthdayWorker sem quebrar o server

// birthdayWorker().catch((err) => {
 // console.error("Erro no birthday worker:", err);
//});

// 🚀 inicia worker sem quebrar o server
campaignWorker().catch(console.error);

const port = Number(process.env.PORT) || 3000;
console.log(`Servidor rodando em http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port: port,
});
