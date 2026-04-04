"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminAuthMiddleware = adminAuthMiddleware;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
async function adminAuthMiddleware(c, next) {
    const authHeader = c.req.header("Authorization");
    if (!authHeader) {
        return c.json({ error: "Token nao enviado" }, 401);
    }
    const token = authHeader.replace("Bearer ", "");
    try {
        const decoded = jsonwebtoken_1.default.verify(token, process.env.JWT_SECRET);
        if (!decoded?.is_admin || !decoded?.id) {
            return c.json({ error: "Token invalido para area admin" }, 401);
        }
        c.set("adminUser", decoded);
        await next();
    }
    catch (error) {
        return c.json({ error: "Token invalido" }, 401);
    }
}
