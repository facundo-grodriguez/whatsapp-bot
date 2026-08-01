import { env } from "../config/env.js";
import {
  getConversationById,
  setConversationState,
} from "../db/repositories/conversations.js";
import { getConversationHistory, insertOutboundMessage } from "../db/repositories/messages.js";
import { engine } from "../engine/index.js";
import { sendText, WahaApiError } from "../waha/client.js";
import { notifyVendor } from "./notifyVendor.js";

export interface HandleIncomingMessageInput {
  conversationId: number;
  sessionName: string;
  chatId: string;
  /** Id del mensaje inbound ya persistido; se usa como in_reply_to_id de la respuesta. */
  inboundMessageId: number;
  body: string;
}

const HISTORY_LIMIT = 20;

function randomDelayMs(): number {
  const { RESPONSE_DELAY_MIN_MS: min, RESPONSE_DELAY_MAX_MS: max } = env;
  return Math.floor(min + Math.random() * (max - min));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Orquesta la reacción a un mensaje entrante ya persistido: decide qué responder
 * (vía /engine), deriva a un vendedor si corresponde, y envía + persiste la
 * respuesta. Corre dentro de la cola de procesamiento (ver src/queue), nunca
 * directamente desde el handler HTTP del webhook.
 */
export async function handleIncomingMessage(input: HandleIncomingMessageInput): Promise<void> {
  const conversation = await getConversationById(input.conversationId);
  if (!conversation) {
    console.error(
      `[handleIncomingMessage] conversación ${input.conversationId} no encontrada, se descarta el mensaje`,
    );
    return;
  }

  // Estado autoritativo al momento de procesar: puede haber cambiado desde que
  // el mensaje se encoló (por ejemplo, otro mensaje de la misma conversación ya
  // la derivó). El mensaje entrante ya quedó logueado por el webhook de todos modos.
  if (conversation.state === "derivada") {
    return;
  }

  const recentHistory = await getConversationHistory(input.conversationId, HISTORY_LIMIT);

  const decision = await engine.decidirRespuesta(input.body, {
    sessionName: input.sessionName,
    chatId: input.chatId,
    state: conversation.state,
    history: recentHistory
      .map((m) => ({ direction: m.direction, body: m.body, createdAt: m.createdAt }))
      .reverse(),
  });

  if (decision.esIntencionCompra) {
    await setConversationState(input.conversationId, "derivada");
    await notifyVendor({
      conversationId: input.conversationId,
      sessionName: input.sessionName,
      chatId: input.chatId,
      body: input.body,
    });
  }

  if (!decision.respuesta) {
    return;
  }

  await delay(randomDelayMs());

  try {
    await sendText({
      session: input.sessionName,
      chatId: input.chatId,
      text: decision.respuesta,
    });
  } catch (error) {
    // No perdemos el mensaje: se persiste igual (con needsHumanReview forzado) para
    // que quede registro de que el bot decidió responder pero el envío falló.
    // El "modo degradado" completo (reintentos, alertas) es de la Fase 3.
    const reason = error instanceof WahaApiError ? error.message : String(error);
    console.error(`[handleIncomingMessage] falló el envío a WAHA: ${reason}`);
    await insertOutboundMessage({
      conversationId: input.conversationId,
      body: decision.respuesta,
      category: decision.categoria,
      isPurchaseIntent: decision.esIntencionCompra,
      needsHumanReview: true,
      inReplyToId: input.inboundMessageId,
    });
    return;
  }

  await insertOutboundMessage({
    conversationId: input.conversationId,
    body: decision.respuesta,
    category: decision.categoria,
    isPurchaseIntent: decision.esIntencionCompra,
    needsHumanReview: decision.requiereRevisionHumana,
    inReplyToId: input.inboundMessageId,
  });
}
