import axios from "axios";

export async function sendWhatsAppMessage(
  instanceId: string,
  token: string,
  phone: string,
  message: string,
  delayMessage: number
) {
  try {
    console.log("[zapi] enviando request", {
      instanceId,
      phone,
      delayMessage,
      messagePreview: message.slice(0, 80),
    });

    const response = await axios.post(
      `https://api.z-api.io/instances/${instanceId}/token/${token}/send-text`,
      {
        phone,
        message,
        delayMessage,
      },
      {
        headers: {
          "Client-Token": process.env.ZAPI_CLIENT_TOKEN,
        },
      }
    );

    console.log("[zapi] resposta de sucesso", {
      instanceId,
      phone,
      response: response.data,
    });

    return { success: true, data: response.data };
  } catch (error: any) {
    console.error("[zapi] erro ao enviar mensagem", {
      instanceId,
      phone,
      status: error.response?.status ?? null,
      data: error.response?.data ?? null,
      message: error.message,
    });

    return {
      success: false,
      error: error.response?.data || error.message,
    };
  }
}
