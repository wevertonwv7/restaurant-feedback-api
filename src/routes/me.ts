import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth";
import type { Variables } from "../types/hono";

const me = new Hono<{ Variables: Variables }>();

me.get("/", authMiddleware, async (c) => {
  const user = c.get("user");

  return c.json({
    user
  });
});

export default me;