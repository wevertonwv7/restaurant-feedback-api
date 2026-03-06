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
      "testeteste12@teste.com",
      passwordHash,
      "20474766-7c9d-44d7-9e9e-60f15ef1d171"
    ]
  );

  console.log("Usuário criado");

}

run();