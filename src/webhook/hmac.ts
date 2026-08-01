import { createHmac, timingSafeEqual } from "node:crypto";

import { env } from "../config/env.js";

/**
 * Verifica la firma HMAC-SHA512 que WAHA agrega en el header `X-Webhook-Hmac`
 * cuando WHATSAPP_HOOK_HMAC_KEY está configurada del lado de WAHA. Si acá no se
 * configuró WAHA_HMAC_KEY, no se verifica (pensado para desarrollo local).
 *
 * Referencia: https://waha.devlike.pro/docs/how-to/events/
 */
export function verifyWahaHmac(rawBody: Buffer, signatureHeader: string | undefined): boolean {
  if (!env.WAHA_HMAC_KEY) {
    return true;
  }
  if (!signatureHeader) {
    return false;
  }

  const expectedHex = createHmac("sha512", env.WAHA_HMAC_KEY).update(rawBody).digest("hex");

  // Comparación en tiempo constante para no filtrar la firma esperada por timing.
  // Si el largo no matchea, timingSafeEqual tira; por eso se chequea antes.
  const expectedBuf = Buffer.from(expectedHex, "hex");
  const receivedBuf = Buffer.from(signatureHeader, "hex");
  if (expectedBuf.length !== receivedBuf.length) {
    return false;
  }

  return timingSafeEqual(expectedBuf, receivedBuf);
}
