"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = authMiddleware;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
async function authMiddleware(c, next) {
    const authHeader = c.req.header("Authorization");
    if (!authHeader) {
        return c.json({ error: "Token não enviado" }, 401);
    }
    const token = authHeader.replace("Bearer ", "");
    try {
        const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
        c.set("user", decoded);
        await next();
    }
    catch (error) {
        return c.json({ error: "Token inválido" }, 401);
    }
}
