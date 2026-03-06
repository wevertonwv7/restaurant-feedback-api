import { Hono } from "hono";
import { pool } from "../db/client";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const auth = new Hono();

auth.post("/login", async (c) => {

  const body = await c.req.json();
  

  const { email, password } = body;

  console.log("BODY RECEBIDO:", { email, password });

  if (!email || !password) {
    return c.json({ error: "Email e senha são obrigatórios" }, 400);
  }

  const result = await pool.query(
    "SELECT id, email, password_hash, restaurant_id FROM users WHERE email = $1",
    [email]
  );

  const user = result.rows[0];

  if (!user) {
    return c.json({ error: "Usuário não encontrado" }, 401);
  }

console.log("USER DO BANCO:", user);
  const passwordMatch = await bcrypt.compare(password, user.password_hash);

  if (!passwordMatch) {
    return c.json({ error: "Senha inválida" }, 401);
  }

  const token = jwt.sign(
    {
      id: user.id,
      restaurant_id: user.restaurant_id
    },
    process.env.JWT_SECRET as string,
    { expiresIn: "7d" }
  );

  return c.json({
    token
  });

});

export default auth;