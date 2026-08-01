import { env } from "../config/env.js";

const SEND_TEXT_TIMEOUT_MS = 10_000;

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

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), SEND_TEXT_TIMEOUT_MS);

  try {
    const response = await fetch(`${env.WAHA_BASE_URL}/api/sendText`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": env.WAHA_API_KEY,
      },
      body: JSON.stringify(input),
      signal: controller.signal,
    });

    if (!response.ok) {
      const bodyText = await response.text().catch(() => "");
      throw new WahaApiError(
        `WAHA respondió ${response.status} al enviar texto: ${bodyText}`,
        response.status,
      );
    }
  } catch (error) {
    if (error instanceof WahaApiError) {
      throw error;
    }
    if (error instanceof Error && error.name === "AbortError") {
      throw new WahaApiError(
        `Timeout de ${SEND_TEXT_TIMEOUT_MS}ms enviando mensaje a WAHA`,
        undefined,
        error,
      );
    }
    throw new WahaApiError("Error de red enviando mensaje a WAHA", undefined, error);
  } finally {
    clearTimeout(timeoutId);
  }
}
