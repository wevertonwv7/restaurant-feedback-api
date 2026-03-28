import { processCampaigns } from "../modules/whatsapp/campaigns";

function delay(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

export async function campaignWorker() {
  console.log("[campaignWorker] worker iniciado");

  while (true) {
    try {
      console.log("[campaignWorker] iniciando ciclo de processamento");
      await processCampaigns();
      console.log("[campaignWorker] ciclo finalizado");

      await delay(1 * 60 * 1000);
    } catch (err: any) {
      console.error("[campaignWorker] erro no worker", {
        error: err?.message ?? err,
        stack: err?.stack ?? null,
      });
    }
  }
}
