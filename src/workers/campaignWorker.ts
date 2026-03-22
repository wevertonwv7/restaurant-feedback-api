import { processCampaigns } from "../modules/whatsapp/campaigns";

function delay(ms: number) {
  return new Promise(res => setTimeout(res, ms));
}

function msUntilNextRun(hour: number, minute: number) {
  const now = new Date();

  const nowSP = new Date(
    now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })
  );

  const next = new Date(nowSP);

  next.setHours(hour, minute, 0, 0);

  if (next <= nowSP) {
    next.setDate(next.getDate() + 1);
  }

  return next.getTime() - nowSP.getTime();
}

export async function campaignWorker() {
  console.log("🚀 Campaign Worker iniciado");

  while (true) {
    try {
      console.log("📢 Processando campanhas...");
      await processCampaigns();

      // roda a cada 5 minutos
      await delay(5 * 60 * 1000);

    } catch (err) {
      console.error("❌ Erro no campaign worker:", err);
    }
  }
}