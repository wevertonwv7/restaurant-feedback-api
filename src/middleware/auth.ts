import { verifyToken } from "../utils/jwt";

export async function authMiddleware(c: any, next: any) {
  const authHeader = c.req.header("Authorization");

  if (!authHeader) {
    return c.json({ error: "Token não enviado" }, 401);
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded: any = verifyToken(token);

    c.set("user", {
  id: user.id,
  email: user.email
});

    await next();
  } catch {
    return c.json({ error: "Token inválido" }, 401);
  }
}