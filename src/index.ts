import "dotenv/config";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { serve } from "@hono/node-server";
import type { Variables } from "./types/hono";


import auth from "./routes/auth";
import feedback from "./routes/feedback";
import birthdays from "./routes/birthdays";
import me from "./routes/me";


const app = new Hono<{ Variables: Variables }>();

app.use("*", cors());

app.get("/", (c) => {
  return c.json({ message: "API funcionando 🚀" });
});

app.route("/api/auth", auth);
app.route("/api/feedback", feedback);
app.route("/api/birthdays", birthdays);
app.route("/api/me", me);

const port = 3000;

console.log(`Servidor rodando em http://localhost:${port}`);

serve({
  fetch: app.fetch,
  port: port,
});