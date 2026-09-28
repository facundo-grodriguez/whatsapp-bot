import { env } from "../../config/env.js";
import { MessagingError } from "../errors.js";
import type { MarkReadAndTypingInput, SendTextInput, SendTextResult } from "../types.js";
import { isRetryableErrorCode } from "./errorCodes.js";

const REQUEST_TIMEOUT_MS = 10_000;

interface GraphErrorBody {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    fbtrace_id?: string;
  };
}

/**
 * POST genérico contra `{channelId}/messages` de la Graph API: timeout con
 * AbortController y error tipado en vez de dejar escapar excepciones crudas
 * de fetch. Meta manda JSON estructurado con el detalle del error incluso en
 * respuestas 4xx/5xx.
 */
async function graphPost(channelId: string, body: unknown): Promise<unknown> {
  const url = `${env.META_GRAPH_BASE_URL}/${env.META_GRAPH_API_VERSION}/${channelId}/messages`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${env.META_ACCESS_TOKEN}`,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    const responseBody = (await response.json().catch(() => ({}))) as GraphErrorBody;

    if (!response.ok) {
      const code = responseBody.error?.code;
      throw new MessagingError(
        `Meta respondió ${response.status} en ${url}: ${responseBody.error?.message ?? "sin detalle"}`,
        {
          status: response.status,
          code,
          subcode: responseBody.error?.error_subcode,
          traceId: responseBody.error?.fbtrace_id,
          retryable: isRetryableErrorCode(code),
        },
      );
    }

    return responseBody;
  } catch (error) {
    if (error instanceof MessagingError) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new MessagingError(`Timeout de ${REQUEST_TIMEOUT_MS}ms llamando a ${url}`, {
        retryable: true,
        cause: error,
      });
    }
    throw new MessagingError(`Error de red llamando a ${url}`, { retryable: true, cause: error });
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Los wa_id de celulares argentinos llegan con un "9" extra después del código
 * de país (ej. wa_id entrante "5491100000000"), pero la Cloud API rechaza el
 * envío a ese mismo string tal cual (131030 "Recipient phone number not in
 * allowed list" en sandbox) — hay que sacar el 9 al mandar. Confirmado con la
 * API real: "5491100000000" rechazado, "541100000000" aceptado y resuelto por
 * Meta al mismo wa_id. No se aplica a otros países (no hay evidencia de que
 * tengan el mismo quirk, y tocar el número de otro país a ciegas es más
 * riesgoso que dejarlo como vino).
 */
function toOutboundRecipient(chatId: string): string {
  return chatId.startsWith("549") ? `54${chatId.slice(3)}` : chatId;
}

/**
 * Envía un mensaje de texto libre vía la Cloud API. En modo dry-run
 * (META_DRY_RUN=true) no hace ningún request real: solo loguea qué se hubiera
 * enviado, para poder probar todo el flujo sin credenciales de Meta.
 */
export async function sendText(input: SendTextInput): Promise<SendTextResult> {
  if (env.META_DRY_RUN) {
    console.log(
      `[cloud-api dry-run] channelId="${input.channelId}" chatId="${input.chatId}" -> ${input.text}`,
    );
    return { providerMessageId: null };
  }

  const response = (await graphPost(input.channelId, {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: toOutboundRecipient(input.chatId),
    type: "text",
    text: { preview_url: false, body: input.text },
  })) as { messages?: Array<{ id?: string }> };

  return { providerMessageId: response.messages?.[0]?.id ?? null };
}

/**
 * Marca como leído y, opcionalmente, muestra "escribiendo…". Cosmético, así
 * que nunca tira: si falla, se loguea y se sigue con el envío real del
 * mensaje.
 */
export async function markReadAndTyping(input: MarkReadAndTypingInput): Promise<void> {
  if (env.META_DRY_RUN) {
    const typingSuffix = input.showTyping ? " (escribiendo...)" : "";
    console.log(
      `[cloud-api dry-run] channelId="${input.channelId}" -> marcado leído${typingSuffix}`,
    );
    return;
  }

  try {
    await graphPost(input.channelId, {
      messaging_product: "whatsapp",
      status: "read",
      message_id: input.providerMessageId,
      ...(input.showTyping ? { typing_indicator: { type: "text" } } : {}),
    });
  } catch (error) {
    const reason = error instanceof MessagingError ? error.message : String(error);
    console.warn(`[cloud-api] no se pudo marcar leído/escribiendo: ${reason}`);
  }
}
