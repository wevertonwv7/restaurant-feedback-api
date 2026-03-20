"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const client_1 = require("../db/client");
const bcrypt_1 = __importDefault(require("bcrypt"));
const crypto_1 = require("crypto");
async function run() {
    const passwordHash = await bcrypt_1.default.hash("123456", 10);
    await client_1.pool.query(`INSERT INTO users (id, email, password_hash, restaurant_id)
     VALUES ($1,$2,$3,$4)`, [
        (0, crypto_1.randomUUID)(),
        "teste@teste.com",
        passwordHash,
        "d37a9a60-d9a1-466f-b2b1-10eb8debd87b"
    ]);
    console.log("Usuário criado");
}
run();
