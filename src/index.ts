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

const app = new Hono<{ Variables: Variables }>();

app.use(
  "*",
  cors({
    origin: ["http://localhost:8080", "http://localhost:5173"],
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

const port = 3000;

console.log(`Servidor rodando em http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port: port,
});