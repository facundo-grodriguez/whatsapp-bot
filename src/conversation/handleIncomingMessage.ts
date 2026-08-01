import { CATEGORY_ERROR_INTERNO } from "../config/categories.js";
import { env } from "../config/env.js";
import { DEGRADED_MODE_MESSAGE } from "../config/messages.js";
import { getConversationById, setConversationState } from "../db/repositories/conversations.js";
import { getConversationHistory, insertOutboundMessage } from "../db/repositories/messages.js";
import { engine } from "../engine/index.js";
import { sendText, startTyping, stopTyping, WahaApiError } from "../waha/client.js";
import { shouldSendDegradedReply } from "./degradedMode.js";
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
 *
 * Envuelve TODO el procesamiento real (processIncomingMessage) en un try/catch:
 * ante cualquier error no controlado (motor, base de datos, lo que sea) cae al
 * modo degradado en vez de dejar al cliente en silencio (Fase 3).
 */
export async function handleIncomingMessage(input: HandleIncomingMessageInput): Promise<void> {
  try {
    await processIncomingMessage(input);
  } catch (error) {
    console.error(
      `[handleIncomingMessage] error no controlado en conversationId=${input.conversationId}:`,
      error,
    );
    await sendDegradedReply(input);
  }
}

async function processIncomingMessage(input: HandleIncomingMessageInput): Promise<void> {
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

  await startTyping({ session: input.sessionName, chatId: input.chatId });
  await delay(randomDelayMs());
  await stopTyping({ session: input.sessionName, chatId: input.chatId });

  try {
    await sendText({
      session: input.sessionName,
      chatId: input.chatId,
      text: decision.respuesta,
    });
  } catch (error) {
    // No perdemos el mensaje: se persiste igual (con needsHumanReview forzado) para
    // que quede registro de que el bot decidió responder pero el envío falló.
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

/**
 * Modo degradado (Fase 3): último recurso ante un error no controlado en
 * `processIncomingMessage`. El objetivo es uno solo — que el cliente nunca quede
 * en silencio — así que cada paso tiene su propio try/catch: una falla enviando
 * no debe impedir el intento de persistir, y viceversa.
 */
async function sendDegradedReply(input: HandleIncomingMessageInput): Promise<void> {
  if (!shouldSendDegradedReply(input.sessionName, input.chatId)) {
    console.warn(
      `[degradedMode] throttled, no se reenvía el mensaje de resguardo a ` +
        `${input.sessionName}:${input.chatId}`,
    );
    return;
  }

  try {
    await sendText({
      session: input.sessionName,
      chatId: input.chatId,
      text: DEGRADED_MODE_MESSAGE,
    });
  } catch (error) {
    // Si WAHA también está caído, no hay más nada por hacer del lado del envío.
    console.error("[degradedMode] no se pudo enviar el mensaje de resguardo:", error);
  }

  try {
    await insertOutboundMessage({
      conversationId: input.conversationId,
      body: DEGRADED_MODE_MESSAGE,
      category: CATEGORY_ERROR_INTERNO,
      isPurchaseIntent: false,
      needsHumanReview: true,
      inReplyToId: input.inboundMessageId,
    });
  } catch (error) {
    // La base puede ser justamente lo que está fallando. Ya se intentó lo más
    // importante (el envío real); no dejar registro es un costo aceptable acá.
    console.error("[degradedMode] no se pudo persistir el mensaje de resguardo:", error);
  }
}
