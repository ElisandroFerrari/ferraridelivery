const encoder = new TextEncoder();

function constantTimeEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  }
  return difference === 0;
}

function statusText(status: string): string {
  const values: Record<string, string> = {
    recebido: "foi recebido",
    em_andamento: "está em andamento",
    saiu_para_entrega: "saiu para entrega",
    pronto: "está pronto",
    cancelado: "foi cancelado",
  };
  return values[status] ?? "foi atualizado";
}

Deno.serve(async (request: Request) => {
  if (request.method !== "POST") {
    return new Response("Método não permitido.", { status: 405 });
  }

  const webhookSecret = Deno.env.get("ORDER_WEBHOOK_SECRET");
  if (!webhookSecret || webhookSecret.length < 32) {
    console.error("ORDER_WEBHOOK_SECRET não foi configurado ou é muito curto.");
    return new Response("Serviço indisponível.", { status: 503 });
  }
  const providedSecret = request.headers.get("x-webhook-secret") ?? "";
  if (!constantTimeEqual(providedSecret, webhookSecret)) {
    return new Response("Não autorizado.", { status: 401 });
  }

  let body: {
    record?: { payload?: { phone?: string | null; order_id?: string; status?: string } };
  };
  try {
    body = await request.json();
  } catch {
    return new Response("Payload inválido.", { status: 400 });
  }
  const payload = body.record?.payload;
  if (!payload?.phone) {
    return Response.json({ delivered: false, reason: "whatsapp_opt_in_missing" }, { status: 200 });
  }
  if (!payload.order_id || !payload.status) {
    return new Response("Evento inválido.", { status: 400 });
  }

  const accessToken = Deno.env.get("WHATSAPP_ACCESS_TOKEN");
  const phoneNumberId = Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
  const templateName = Deno.env.get("WHATSAPP_TEMPLATE_NAME");
  const languageCode = Deno.env.get("WHATSAPP_TEMPLATE_LANGUAGE") ?? "pt_BR";
  const graphVersion = Deno.env.get("WHATSAPP_GRAPH_API_VERSION") ?? "v22.0";
  if (!accessToken || !phoneNumberId || !templateName) {
    console.error("Segredos da API do WhatsApp não estão completamente configurados.");
    return new Response("Serviço indisponível.", { status: 503 });
  }

  const digits = payload.phone.replace(/\D/g, "");
  const recipient = digits.startsWith("55") ? digits : `55${digits}`;
  if (recipient.length < 12 || recipient.length > 13) {
    console.error("Telefone inválido para envio de notificação.");
    return new Response("Telefone inválido.", { status: 422 });
  }

  const graphUrl = `https://graph.facebook.com/${graphVersion}/${encodeURIComponent(phoneNumberId)}/messages`;
  const message = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: recipient,
    type: "template",
    template: {
      name: templateName,
      language: { code: languageCode },
      components: [{
        type: "body",
        parameters: [
          { type: "text", text: payload.order_id.slice(0, 8).toUpperCase() },
          { type: "text", text: statusText(payload.status) },
        ],
      }],
    },
  };

  let response: Response;
  try {
    response = await fetch(graphUrl, {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(message),
    });
  } catch (error) {
    console.error("Falha de rede ao enviar a notificação do pedido.", error);
    return new Response("Falha ao enviar notificação.", { status: 502 });
  }
  if (!response.ok) {
    console.error("A API do WhatsApp recusou a notificação.", response.status);
    return new Response("Falha ao enviar notificação.", { status: 502 });
  }
  return Response.json({ delivered: true }, { status: 200 });
});
