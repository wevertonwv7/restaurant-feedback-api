import axios from "axios";

export async function getQRCode(instanceId: string, token: string) {

  const response = await axios.get(
    `https://api.z-api.io/instances/${instanceId}/token/${token}/qr-code/image`, 
    {
    headers: {
      "Client-Token": process.env.ZAPI_CLIENT_TOKEN
    }
  }
  );

  return response.data;

}