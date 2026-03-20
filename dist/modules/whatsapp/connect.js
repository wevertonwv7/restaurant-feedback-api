"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getQRCode = getQRCode;
const axios_1 = __importDefault(require("axios"));
async function getQRCode(instanceId, token) {
    const response = await axios_1.default.get(`https://api.z-api.io/instances/${instanceId}/token/${token}/qr-code/image`, {
        headers: {
            "Client-Token": process.env.ZAPI_CLIENT_TOKEN
        }
    });
    return response.data;
}
