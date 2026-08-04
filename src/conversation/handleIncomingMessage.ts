import { CATEGORY_ERROR_INTERNO } from "../config/categories.js";
import { env } from "../config/env.js";
import { DEGRADED_MODE_MESSAGE } from "../config/messages.js";
import { getConversationById, setConversationState } from "../db/repositories/conversations.js";
import { getConversationHistory, insertOutboundMessage } from "../db/repositories/messages.js";
import { engine } from "../engine/index.js";
import { MessagingError, messaging, type SendTextInput, type SendTextResult } from "../messaging/index.js";
import { shouldSendDegradedReply } from "./degradedMode.js";
import { notifyVendor } from "./notifyVendor.js";

export interface HandleIncomingMessageInput {
  conversationId: number;
  channelId: string;
  chatId: string;
  /** Id del mensaje inbound ya persistido; se usa como in_reply_to_id de la respuesta. */
  inboundMessageId: number;
  /** Id del mensaje entrante del lado del proveedor — necesario para marcarlo
   *  como leído (ver messaging.markReadAndTyping). */
  providerMessageId: string;
  body: string;
}

const HISTORY_LIMIT = 20;

// Reintentos ante una falla puntual del proveedor de mensajería (ej. blip de
// red, error 5xx transitorio) antes de resignarse y marcar needsHumanReview.
// Backoff corto y acotado: no tiene sentido reintentar por más de unos segundos,
// y no queremos retener la conversación en la cola (ver src/queue/messageQueue.ts)
// más de lo necesario.
const SEND_RETRY_DELAYS_MS = [1000, 2000];

function randomDelayMs(): number {
  const { RESPONSE_DELAY_MIN_MS: min, RESPONSE_DELAY_MAX_MS: max } = env;
  return Math.floor(min + Math.random() * (max - min));
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Envuelve `messaging.sendText` con reintentos ante error (1 intento inicial +
 * los backoffs de `SEND_RETRY_DELAYS_MS`). Corta antes si el error viene
 * marcado `retryable: false` (ej. token vencido, ventana de 24h cerrada — ver
 * src/messaging/cloudApi/errorCodes.ts): insistir con esos no cambia el
 * resultado, solo gasta tiempo de cola. Si se agotan los reintentos (o el
 * error no es reintentable), se propaga tal cual para que el llamador lo trate
 * igual que antes (mensaje persistido con `needsHumanReview: true`).
 */
async function sendTextWithRetry(input: SendTextInput): Promise<SendTextResult> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await messaging.sendText(input);
    } catch (error) {
      const retryable = !(error instanceof MessagingError) || error.retryable;
      if (!retryable || attempt >= SEND_RETRY_DELAYS_MS.length) {
        throw error;
      }
      console.warn(
        `[handleIncomingMessage] falló el envío (intento ${attempt + 1}), reintentando: ${
          error instanceof MessagingError ? error.message : String(error)
        }`,
      );
      await delay(SEND_RETRY_DELAYS_MS[attempt]!);
    }
  }
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
    channelId: input.channelId,
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
      channelId: input.channelId,
      chatId: input.chatId,
      body: input.body,
    });
  }

  if (!decision.respuesta) {
    return;
  }

  // Una sola llamada: la Cloud API no tiene "stopTyping", el indicador se apaga
  // solo al llegar el mensaje real (o a los 25s) — ver messaging/types.ts.
  await messaging.markReadAndTyping({
    channelId: input.channelId,
    providerMessageId: input.providerMessageId,
    showTyping: true,
  });
  await delay(randomDelayMs());

  let sendResult: SendTextResult;
  try {
    sendResult = await sendTextWithRetry({
      channelId: input.channelId,
      chatId: input.chatId,
      text: decision.respuesta,
    });
  } catch (error) {
    // Se agotaron los reintentos (ver sendTextWithRetry). No perdemos el mensaje:
    // se persiste igual (con needsHumanReview forzado) para que quede registro de
    // que el bot decidió responder pero el envío falló.
    const reason = error instanceof MessagingError ? error.message : String(error);
    console.error(`[handleIncomingMessage] falló el envío tras reintentar: ${reason}`);
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
    providerMessageId: sendResult.providerMessageId,
  });
}

/**
 * Modo degradado (Fase 3): último recurso ante un error no controlado en
 * `processIncomingMessage`. El objetivo es uno solo — que el cliente nunca quede
 * en silencio — así que cada paso tiene su propio try/catch: una falla enviando
 * no debe impedir el intento de persistir, y viceversa.
 */
async function sendDegradedReply(input: HandleIncomingMessageInput): Promise<void> {
  if (!shouldSendDegradedReply(input.channelId, input.chatId)) {
    console.warn(
      `[degradedMode] throttled, no se reenvía el mensaje de resguardo a ` +
        `${input.channelId}:${input.chatId}`,
    );
    return;
  }

  let sendResult: SendTextResult | null = null;
  try {
    sendResult = await messaging.sendText({
      channelId: input.channelId,
      chatId: input.chatId,
      text: DEGRADED_MODE_MESSAGE,
    });
  } catch (error) {
    // Si el proveedor también está caído, no hay más nada por hacer del lado del envío.
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
      providerMessageId: sendResult?.providerMessageId ?? null,
    });
  } catch (error) {
    // La base puede ser justamente lo que está fallando. Ya se intentó lo más
    // importante (el envío real); no dejar registro es un costo aceptable acá.
    console.error("[degradedMode] no se pudo persistir el mensaje de resguardo:", error);
  }
}
