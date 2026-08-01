import type { FastifyInstance } from "fastify";

import { handleIncomingMessage } from "../conversation/handleIncomingMessage.js";
import { findOrCreateConversation } from "../db/repositories/conversations.js";
import { insertInboundMessageIfNew } from "../db/repositories/messages.js";
import { enqueueMessageProcessing } from "../queue/messageQueue.js";
import { wahaWebhookEventSchema } from "../waha/types.js";
import { verifyWahaHmac } from "./hmac.js";

const GROUP_CHAT_SUFFIX = "@g.us";

export async function registerWebhookRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.post("/webhook/waha", async (request, reply) => {
    const signatureHeader = request.headers["x-webhook-hmac"];
    const signature = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    // Si por algún motivo no se capturó el body crudo (content-type distinto de
    // application/json), se verifica sobre el JSON re-serializado: sigue siendo
    // mejor que no verificar nada, aunque en el caso normal rawBody siempre está.
    const rawBody = request.rawBody ?? Buffer.from(JSON.stringify(request.body ?? {}));

    if (!verifyWahaHmac(rawBody, signature)) {
      request.log.warn("Firma HMAC inválida en el webhook de WAHA, se rechaza");
      return reply.code(401).send({ error: "invalid_signature" });
    }

    const parsed = wahaWebhookEventSchema.safeParse(request.body);
    if (!parsed.success) {
      request.log.warn({ issues: parsed.error.issues }, "Payload de webhook de WAHA inválido");
      // 200 igual: si devolviéramos error, WAHA reintentaría un payload que
      // nunca va a pasar a ser válido.
      return reply.code(200).send({ ignored: true, reason: "invalid_payload" });
    }

    const event = parsed.data;

    if (event.event !== "message") {
      return reply.code(200).send({ ignored: true, reason: "not_a_message_event" });
    }
    if (event.payload.fromMe) {
      // Sin este filtro el bot terminaría respondiéndose a sí mismo en loop.
      return reply.code(200).send({ ignored: true, reason: "from_me" });
    }
    if (event.payload.from.endsWith(GROUP_CHAT_SUFFIX)) {
      // Grupos fuera de alcance de la Fase 1 (ver plan de fases).
      return reply.code(200).send({ ignored: true, reason: "group_chat" });
    }

    const conversation = await findOrCreateConversation(event.session, event.payload.from);

    const waTimestamp = Number.isFinite(event.payload.timestamp)
      ? new Date(event.payload.timestamp * 1000)
      : null;

    const inboundMessage = await insertInboundMessageIfNew({
      conversationId: conversation.id,
      wahaMessageId: event.payload.id,
      body: event.payload.body,
      waTimestamp,
    });

    if (!inboundMessage) {
      // WAHA reintentó un webhook que ya habíamos procesado: idempotente, no se re-encola.
      return reply.code(200).send({ ignored: true, reason: "duplicate_message" });
    }

    // Sin await a propósito: el procesamiento (decidir respuesta, enviar,
    // persistir) pasa a la cola y el webhook responde 200 de inmediato, antes de
    // que WAHA lo reintente por timeout.
    enqueueMessageProcessing(() =>
      handleIncomingMessage({
        conversationId: conversation.id,
        sessionName: event.session,
        chatId: event.payload.from,
        inboundMessageId: inboundMessage.id,
        body: inboundMessage.body,
      }),
    );

    return reply.code(200).send({ ok: true });
  });
}
