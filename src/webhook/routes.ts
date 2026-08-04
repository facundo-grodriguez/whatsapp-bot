import type { FastifyInstance } from "fastify";

import { env } from "../config/env.js";
import { handleIncomingMessage } from "../conversation/handleIncomingMessage.js";
import { findOrCreateConversation } from "../db/repositories/conversations.js";
import { insertInboundMessageIfNew, updateDeliveryStatus } from "../db/repositories/messages.js";
import { messaging } from "../messaging/index.js";
import { enqueueMessageProcessing } from "../queue/messageQueue.js";

interface VerifyQuerystring {
  "hub.mode"?: string;
  "hub.verify_token"?: string;
  "hub.challenge"?: string;
}

export async function registerWebhookRoutes(fastify: FastifyInstance): Promise<void> {
  /**
   * Verificación del webhook (sin equivalente en WAHA): Meta la dispara una
   * sola vez, al cargar la Callback URL en el App Dashboard, para confirmar que
   * el endpoint es tuyo. Responde con el `hub.challenge` tal cual, como texto
   * plano — no JSON — solo si el token coincide con META_VERIFY_TOKEN.
   */
  fastify.get<{ Querystring: VerifyQuerystring }>("/webhook/whatsapp", async (request, reply) => {
    const { "hub.mode": mode, "hub.verify_token": token, "hub.challenge": challenge } = request.query;

    if (mode === "subscribe" && token && env.META_VERIFY_TOKEN && token === env.META_VERIFY_TOKEN) {
      return reply.code(200).type("text/plain").send(challenge ?? "");
    }

    request.log.warn("Verificación de webhook de Meta rechazada (token no coincide)");
    return reply.code(403).send();
  });

  fastify.post("/webhook/whatsapp", async (request, reply) => {
    const signatureHeader = request.headers["x-hub-signature-256"];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;

    if (!request.rawBody) {
      // A diferencia de WAHA, acá no hay fallback razonable: Meta firma los
      // bytes EXACTOS del body, así que un JSON re-serializado nunca va a
      // coincidir con la firma — mejor un motivo explícito que un 401 opaco.
      request.log.error("No se capturó el body crudo del webhook, no se puede verificar la firma");
      return reply.code(200).send({ ignored: true, reason: "missing_raw_body" });
    }

    if (!messaging.verifyWebhookSignature(request.rawBody, signature)) {
      request.log.warn("Firma inválida en el webhook de WhatsApp, se rechaza");
      // 401 a propósito (no 200): una firma que falla siempre significa
      // META_APP_SECRET mal configurado — conviene que Meta reintente y que
      // quede ruidoso en vez de tragárselo en silencio.
      return reply.code(401).send({ error: "invalid_signature" });
    }

    const parsed = messaging.parseWebhook(request.body);

    if (parsed.ignored.length > 0) {
      request.log.info({ ignored: parsed.ignored }, "Entradas del webhook descartadas");
    }
    for (const status of parsed.statuses) {
      if (status.status === "failed") {
        request.log.warn(
          { providerMessageId: status.providerMessageId, code: status.errorCode, title: status.errorTitle },
          "Meta reportó que un mensaje saliente falló",
        );
      }
      // Best-effort: si no matchea ningún mensaje (ver updateDeliveryStatus), no
      // pasa nada — el webhook igual tiene que responder 200 por el resto del lote.
      await updateDeliveryStatus(status.providerMessageId, status.status);
    }

    let accepted = 0;
    let duplicates = 0;

    for (const message of parsed.messages) {
      const conversation = await findOrCreateConversation(
        message.channelId,
        message.chatId,
        message.senderName,
      );

      const inboundMessage = await insertInboundMessageIfNew({
        conversationId: conversation.id,
        providerMessageId: message.providerMessageId,
        body: message.body,
        waTimestamp: message.timestamp,
      });

      if (!inboundMessage) {
        // Meta reintentó un webhook que ya habíamos procesado: idempotente, no se re-encola.
        duplicates++;
        continue;
      }

      accepted++;

      // Sin await a propósito: el procesamiento (decidir respuesta, enviar,
      // persistir) pasa a la cola y el webhook responde 200 de inmediato, antes
      // de que Meta lo reintente por timeout.
      enqueueMessageProcessing(conversation.id, () =>
        handleIncomingMessage({
          conversationId: conversation.id,
          channelId: message.channelId,
          chatId: message.chatId,
          inboundMessageId: inboundMessage.id,
          providerMessageId: message.providerMessageId,
          body: inboundMessage.body,
        }),
      );
    }

    return reply.code(200).send({
      accepted,
      duplicates,
      ignored: parsed.ignored.length,
      statuses: parsed.statuses.length,
    });
  });
}
