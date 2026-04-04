import type { Context, Next } from "hono";
import jwt from "jsonwebtoken";

import type { Variables } from "../types/hono";

type AdminJwtPayload = Variables["adminUser"];

export async function adminAuthMiddleware(
  c: Context<{ Variables: Variables }>,
  next: Next
) {
  const authHeader = c.req.header("Authorization");

  if (!authHeader) {
    return c.json({ error: "Token nao enviado" }, 401);
  }

  const token = authHeader.replace("Bearer ", "");

  try {
    const decoded = jwt.verify(
      token,
      process.env.JWT_SECRET as string
    ) as AdminJwtPayload;

    if (!decoded?.is_admin || !decoded?.id) {
      return c.json({ error: "Token invalido para area admin" }, 401);
    }

    c.set("adminUser", decoded);
    await next();
  } catch (error) {
    return c.json({ error: "Token invalido" }, 401);
  }
}
