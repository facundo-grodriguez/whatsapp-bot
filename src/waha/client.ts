import { env } from "../config/env.js";

const REQUEST_TIMEOUT_MS = 10_000;

/** Error tipado para cualquier falla al hablar con la API de WAHA (HTTP, timeout o red). */
export class WahaApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "WahaApiError";
  }
}

export interface SendTextInput {
  session: string;
  chatId: string;
  text: string;
}

export interface ChatSessionInput {
  session: string;
  chatId: string;
}

async function wahaPost(path: string, body: unknown): Promise<void> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(`${env.WAHA_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": env.WAHA_API_KEY,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      throw new WahaApiError(
        `WAHA respondió ${response.status} en ${path}: ${bodyText}`,
        response.status,
      );
    }
  } catch (error) {
    if (error instanceof WahaApiError) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new WahaApiError(`Timeout de ${REQUEST_TIMEOUT_MS}ms llamando a ${path}`, undefined, error);
    }
    throw new WahaApiError(`Error de red llamando a ${path}`, undefined, error);
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Envía un mensaje de texto vía WAHA (POST /api/sendText). En modo dry-run
 * (WAHA_DRY_RUN=true) no hace ningún request real: solo loguea qué se hubiera
 * enviado, para poder probar todo el flujo sin tener WAHA corriendo.
 */
export async function sendText(input: SendTextInput): Promise<void> {
  if (env.WAHA_DRY_RUN) {
    console.log(
      `[WAHA dry-run] session="${input.session}" chatId="${input.chatId}" -> ${input.text}`,
    );
    return;
  }

  await wahaPost("/api/sendText", input);
}

/**
 * Marca "escribiendo…" en el chat (POST /api/startTyping). Es cosmético — simula
 * el ritmo de una persona respondiendo en vez de contestar instantáneo — así que
 * nunca tira: si WAHA no expone el endpoint o falla, se loguea y se sigue con el
 * envío real del mensaje.
 */
export async function startTyping(input: ChatSessionInput): Promise<void> {
  if (env.WAHA_DRY_RUN) {
    console.log(`[WAHA dry-run] session="${input.session}" chatId="${input.chatId}" -> (escribiendo...)`);
    return;
  }

  try {
    await wahaPost("/api/startTyping", input);
  } catch (error) {
    const reason = error instanceof WahaApiError ? error.message : String(error);
    console.warn(`[waha] no se pudo marcar "escribiendo": ${reason}`);
  }
}

/** Contraparte de {@link startTyping}. Mismo criterio: nunca tira. */
export async function stopTyping(input: ChatSessionInput): Promise<void> {
  if (env.WAHA_DRY_RUN) {
    return;
  }

  try {
    await wahaPost("/api/stopTyping", input);
  } catch (error) {
    const reason = error instanceof WahaApiError ? error.message : String(error);
    console.warn(`[waha] no se pudo desmarcar "escribiendo": ${reason}`);
  }
}
