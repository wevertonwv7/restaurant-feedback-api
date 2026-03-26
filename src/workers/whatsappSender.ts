import { pool } from "../db/client";
import { sendWhatsAppMessage } from "../modules/whatsapp/sendMessage";

function delay(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function whatsappWorker() {

  console.log("🚀 Worker iniciado");

  while (true) {

    const messages = await pool.query(
      `
      SELECT wm.*, wi.zapi_instance_id, wi.zapi_token
      FROM whatsapp_messages wm
      JOIN whatsapp_instances wi
        ON wi.restaurant_id = wm.restaurant_id
      WHERE wm.status = 'pending'
      AND (wm.scheduled_at IS NULL OR wm.scheduled_at <= NOW())
      LIMIT 5
      `
    );

    for (const msg of messages.rows) {

  try {

    console.log("📤 Enviando mensagem:", {
      id: msg.id,
      phone: msg.phone,
    });

    await pool.query(
      `UPDATE whatsapp_messages SET status = 'sending' WHERE id = $1`,
      [msg.id]
    );
    

    const result = await sendWhatsAppMessage(
      msg.zapi_instance_id,
      msg.zapi_token,
      msg.phone,
      msg.message,
      msg.delay_message = 5
    );

    if (result.success) {

      console.log("✅ Mensagem enviada:", result.data);

      await pool.query(
        `
        UPDATE whatsapp_messages
        SET status = 'sent', sent_at = NOW()
        WHERE id = $1
        `,
        [msg.id]
      );

    } else {

      console.error("❌ Erro ao enviar mensagem:", {
        id: msg.id,
        error: result.error
      });

      await pool.query(
        `
        UPDATE whatsapp_messages
        SET status = 'error', error = $2
        WHERE id = $1
        `,
        [msg.id, JSON.stringify(result.error)]
      );

    }

    await delay(8000);

  } catch (err: any) {

    console.error("💥 Erro inesperado no worker:", err);

    await pool.query(
      `
      UPDATE whatsapp_messages
      SET status = 'error', error = $2
      WHERE id = $1
      `,
      [msg.id, err.message]
    );

  }

}
    // espera antes de buscar mais
    await delay(5000);
  }
}