"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.campaignWorker = campaignWorker;
const campaigns_1 = require("../modules/whatsapp/campaigns");
function delay(ms) {
    return new Promise(res => setTimeout(res, ms));
}
function msUntilNextRun(hour, minute) {
    const now = new Date();
    const nowSP = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const next = new Date(nowSP);
    next.setHours(hour, minute, 0, 0);
    if (next <= nowSP) {
        next.setDate(next.getDate() + 1);
    }
    return next.getTime() - nowSP.getTime();
}
async function campaignWorker() {
    console.log("🚀 Campaign Worker iniciado");
    while (true) {
        try {
            console.log("📢 Processando campanhas...");
            await (0, campaigns_1.processCampaigns)();
            // roda a cada 5 minutos
            await delay(1 * 60 * 1000);
        }
        catch (err) {
            console.error("❌ Erro no campaign worker:", err);
        }
    }
}
