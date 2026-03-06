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


const app = new Hono<{ Variables: Variables }>();

app.use("*", async (c, next) => {
  c.header("Access-Control-Allow-Origin", "http://localhost:8080"); // ou 5173, dependendo do seu frontend
  c.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  c.header("Access-Control-Allow-Headers", "Content-Type, Authorization");
  c.header("Access-Control-Allow-Credentials", "true");

  // Responde requisições preflight OPTIONS sem passar adiante
  if (c.req.method === "OPTIONS") return c.text("OK", 200);

  return next();
});

app.get("/", (c) => {
  return c.json({ message: "API funcionando 🚀" });
});

app.route("/api/auth", auth);
app.route("/api/feedback", feedback);
app.route("/api/feedbacks", feedbacks);
app.route("/api/birthdays", birthdays);
app.route("/api/me", me);
app.route("/api/restaurant", restaurant);

const port = 3000;

console.log(`Servidor rodando em http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port: port,
});