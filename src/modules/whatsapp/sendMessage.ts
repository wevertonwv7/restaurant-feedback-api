import axios from "axios";

export async function sendWhatsAppMessage(
  instanceId: string,
  token: string,
  phone: string,
  message: string,
  delayMessage: number
) {
  try {
    console.log("Enviando mensagem para WhatsApp:", { phone, message });

    const response = await axios.post(
      `https://api.z-api.io/instances/${instanceId}/token/${token}/send-text`,
      {
        phone,
        message,
        delayMessage
      },
      {
        headers: {
          "Client-Token": process.env.ZAPI_CLIENT_TOKEN
        }
      }
    );

    console.log("Resposta da API do WhatsApp:", response.data);

    return { success: true, data: response.data };

  } catch (error: any) {
    console.error("❌ ERRO Z-API:", error.response?.data || error.message);

    return {
      success: false,
      error: error.response?.data || error.message
    };
  }
}