import { pool } from "../db/client";
import { sendDetractorAlertMessage } from "../modules/whatsapp/sendAlertMessage";

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function alertWorker() {
  console.log("[alertWorker] worker iniciado");

  while (true) {
    try {
      const alerts = await pool.query(
        `
        SELECT *
        FROM whatsapp_alert_messages
        WHERE status = 'pending'
        ORDER BY created_at ASC
        LIMIT 10
        `
      );

      console.log("[alertWorker] lote carregado", {
        pendingAlerts: alerts.rows.length,
      });

      if (alerts.rows.length === 0) {
        await delay(5000);
        continue;
      }

      for (const alert of alerts.rows) {
        try {
          console.log("[alertWorker] enviando alerta", {
            id: alert.id,
            restaurantId: alert.restaurant_id,
            campaignId: alert.campaign_id ?? null,
            customerId: alert.customer_id ?? null,
            phone: alert.phone,
          });

          await pool.query(
            `UPDATE whatsapp_alert_messages SET status = 'sending' WHERE id = $1`,
            [alert.id]
          );

          const result = await sendDetractorAlertMessage(
            alert.phone,
            alert.message,
            1
          );

          if (result.success) {
            await pool.query(
              `
              UPDATE whatsapp_alert_messages
              SET status = 'sent', sent_at = NOW(), error = null
              WHERE id = $1
              `,
              [alert.id]
            );

            console.log("[alertWorker] alerta enviado com sucesso", {
              id: alert.id,
              phone: alert.phone,
            });
          } else {
            await pool.query(
              `
              UPDATE whatsapp_alert_messages
              SET status = 'error', error = $2
              WHERE id = $1
              `,
              [alert.id, JSON.stringify(result.error)]
            );

            console.error("[alertWorker] falha no envio do alerta", {
              id: alert.id,
              phone: alert.phone,
              error: result.error,
            });
          }
        } catch (err: any) {
          await pool.query(
            `
            UPDATE whatsapp_alert_messages
            SET status = 'error', error = $2
            WHERE id = $1
            `,
            [alert.id, err?.message ?? "Erro inesperado ao enviar alerta"]
          );

          console.error("[alertWorker] erro inesperado ao processar alerta", {
            id: alert.id,
            error: err?.message ?? err,
            stack: err?.stack ?? null,
          });
        }
      }
    } catch (err: any) {
      console.error("[alertWorker] erro ao carregar fila de alertas", {
        error: err?.message ?? err,
        stack: err?.stack ?? null,
      });
    }

    await delay(5000);
  }
}
