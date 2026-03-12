import { Context, Next } from "hono";
import jwt from "jsonwebtoken";

export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header("Authorization");

  if (!authHeader) {
    return c.json({ error: "Token não enviado" }, 401);
  }

  const token = authHeader.replace("Bearer ", "");

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET as string);

    c.set("user", decoded);

    await next();
  } catch (error) {
    return c.json({ error: "Token inválido" }, 401);
  }
}