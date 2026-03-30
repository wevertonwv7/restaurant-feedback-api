"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.campaignWorker = campaignWorker;
const campaigns_1 = require("../modules/whatsapp/campaigns");
function delay(ms) {
    return new Promise((res) => setTimeout(res, ms));
}
async function campaignWorker() {
    console.log("[campaignWorker] worker iniciado");
    while (true) {
        try {
            console.log("[campaignWorker] iniciando ciclo de processamento");
            await (0, campaigns_1.processCampaigns)();
            console.log("[campaignWorker] ciclo finalizado");
            await delay(1 * 60 * 1000);
        }
        catch (err) {
            console.error("[campaignWorker] erro no worker", {
                error: err?.message ?? err,
                stack: err?.stack ?? null,
            });
        }
    }
}
