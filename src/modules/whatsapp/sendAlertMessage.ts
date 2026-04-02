import axios from "axios";

const alertInstanceId = process.env.ALERT_ZAPI_INSTANCE_ID;
const alertToken = process.env.ALERT_ZAPI_TOKEN;
const alertClientToken = process.env.ALERT_ZAPI_CLIENT_TOKEN;

export async function sendDetractorAlertMessage(
  phone: string,
  message: string,
  delayMessage: number
) {
  if (!alertInstanceId || !alertToken || !alertClientToken) {
    return {
      success: false,
      error: "ALERT_ZAPI_INSTANCE_ID, ALERT_ZAPI_TOKEN ou ALERT_ZAPI_CLIENT_TOKEN nao configurados",
    };
  }

  try {
    console.log("[alert-zapi] enviando alerta", {
      instanceId: alertInstanceId,
      phone,
      delayMessage,
      messagePreview: message.slice(0, 80),
    });

    const response = await axios.post(
      `https://api.z-api.io/instances/${alertInstanceId}/token/${alertToken}/send-text`,
      {
        phone,
        message,
        delayMessage,
      },
      {
        headers: {
          "Client-Token": alertClientToken,
        },
      }
    );

    console.log("[alert-zapi] resposta de sucesso", {
      phone,
      response: response.data,
    });

    return { success: true, data: response.data };
  } catch (error: any) {
    console.error("[alert-zapi] erro ao enviar alerta", {
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
