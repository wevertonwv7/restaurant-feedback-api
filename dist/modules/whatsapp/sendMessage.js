"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.sendWhatsAppMessage = sendWhatsAppMessage;
const axios_1 = __importDefault(require("axios"));
async function sendWhatsAppMessage(instanceId, token, phone, message, delayMessage) {
    try {
        console.log("Enviando mensagem para WhatsApp:", { phone, message });
        const response = await axios_1.default.post(`https://api.z-api.io/instances/${instanceId}/token/${token}/send-text`, {
            phone,
            message,
            delayMessage
        }, {
            headers: {
                "Client-Token": process.env.ZAPI_CLIENT_TOKEN
            }
        });
        console.log("Resposta da API do WhatsApp:", response.data);
        return { success: true, data: response.data };
    }
    catch (error) {
        console.error("❌ ERRO Z-API:", error.response?.data || error.message);
        return {
            success: false,
            error: error.response?.data || error.message
        };
    }
}
