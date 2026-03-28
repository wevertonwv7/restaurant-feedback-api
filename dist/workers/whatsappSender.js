"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.whatsappWorker = whatsappWorker;
const client_1 = require("../db/client");
const sendMessage_1 = require("../modules/whatsapp/sendMessage");
function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
async function whatsappWorker() {
    console.log("[whatsappWorker] worker iniciado");
    while (true) {
        try {
            const messages = await client_1.pool.query(`
        SELECT wm.*, wi.zapi_instance_id, wi.zapi_token
        FROM whatsapp_messages wm
        JOIN whatsapp_instances wi
          ON wi.restaurant_id = wm.restaurant_id
        WHERE wm.status = 'pending'
        AND (wm.scheduled_at IS NULL OR wm.scheduled_at <= NOW())
        LIMIT 5
        `);
            console.log("[whatsappWorker] lote carregado", {
                pendingReadyCount: messages.rows.length,
            });
            if (messages.rows.length === 0) {
                await delay(5000);
                continue;
            }
            for (const msg of messages.rows) {
                try {
                    console.log("[whatsappWorker] enviando mensagem", {
                        id: msg.id,
                        restaurantId: msg.restaurant_id,
                        campaignId: msg.campaign_id ?? null,
                        customerId: msg.customer_id ?? null,
                        phone: msg.phone,
                        scheduledAt: msg.scheduled_at,
                        currentStatus: msg.status,
                    });
                    await client_1.pool.query(`UPDATE whatsapp_messages SET status = 'sending' WHERE id = $1`, [msg.id]);
                    const result = await (0, sendMessage_1.sendWhatsAppMessage)(msg.zapi_instance_id, msg.zapi_token, msg.phone, msg.message, msg.delay_message ?? 5);
                    if (result.success) {
                        console.log("[whatsappWorker] mensagem enviada com sucesso", {
                            id: msg.id,
                            phone: msg.phone,
                            providerResponse: result.data,
                        });
                        await client_1.pool.query(`
              UPDATE whatsapp_messages
              SET status = 'sent', sent_at = NOW(), error = null
              WHERE id = $1
              `, [msg.id]);
                        console.log("[whatsappWorker] mensagem marcada como sent", {
                            id: msg.id,
                        });
                    }
                    else {
                        console.error("[whatsappWorker] erro ao enviar mensagem", {
                            id: msg.id,
                            phone: msg.phone,
                            error: result.error,
                        });
                        await client_1.pool.query(`
              UPDATE whatsapp_messages
              SET status = 'error', error = $2
              WHERE id = $1
              `, [msg.id, JSON.stringify(result.error)]);
                    }
                    await delay(8000);
                }
                catch (err) {
                    console.error("[whatsappWorker] erro inesperado ao processar mensagem", {
                        id: msg.id,
                        phone: msg.phone,
                        error: err?.message ?? err,
                        stack: err?.stack ?? null,
                    });
                    await client_1.pool.query(`
            UPDATE whatsapp_messages
            SET status = 'error', error = $2
            WHERE id = $1
            `, [msg.id, err?.message ?? "Erro inesperado no worker"]);
                }
            }
        }
        catch (err) {
            console.error("[whatsappWorker] falha ao carregar lote de mensagens", {
                error: err?.message ?? err,
                stack: err?.stack ?? null,
            });
        }
        await delay(5000);
    }
}
