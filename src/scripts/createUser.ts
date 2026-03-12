import "dotenv/config";
import { pool } from "../db/client";
import bcrypt from "bcrypt";
import { randomUUID } from "crypto";

async function run() {

  const passwordHash = await bcrypt.hash("123456", 10);

  await pool.query(
    `INSERT INTO users (id, email, password_hash, restaurant_id)
     VALUES ($1,$2,$3,$4)`,
    [
      randomUUID(),
      "teste@teste.com",
      passwordHash,
      "d37a9a60-d9a1-466f-b2b1-10eb8debd87b"
    ]
  );

  console.log("Usuário criado");

}

run();