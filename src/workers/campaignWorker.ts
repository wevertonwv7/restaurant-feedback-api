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

  const HOUR_TO_RUN = 11;    // 🔥 hora desejada
  const MINUTE_TO_RUN = 27 // 🔥 minuto desejado

  while (true) {
    try {
      const waitTime = msUntilNextRun(HOUR_TO_RUN, MINUTE_TO_RUN);

      console.log(
        `⏳ Próxima execução em ${Math.round(waitTime / 1000 / 60)} minutos`
      );

      await delay(waitTime);

      console.log("📢 Executando campanhas agora...");
      await processCampaigns();

    } catch (err) {
      console.error("❌ Erro no campaign worker:", err);
    }
  }
}