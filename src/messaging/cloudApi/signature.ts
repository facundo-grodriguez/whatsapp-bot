import { createHmac, timingSafeEqual } from "node:crypto";

const SIGNATURE_PREFIX = "sha256=";

/**
 * Verifica la firma HMAC-SHA256 que Meta agrega en el header
 * `X-Hub-Signature-256` de cada webhook, keyed con el **App Secret** (no el
 * access token — son cosas distintas). Si no hay `appSecret` configurado, no se
 * verifica (pensado para desarrollo local, igual que WAHA_HMAC_KEY antes).
 *
 * Pura a propósito (recibe `appSecret` por parámetro en vez de leer `env`
 * directamente, a diferencia del `verifyWahaHmac` que reemplaza): así se puede
 * testear el caso "sin secret configurado" y el caso "con secret" en el mismo
 * proceso de test, sin pelear con que `env` es un singleton fijado al importar
 * el módulo. `env.META_APP_SECRET` se inyecta desde CloudApiProvider.
 *
 * Distinto del HMAC de WAHA en tres cosas: SHA256 en vez de SHA512, el header
 * trae un prefijo `sha256=` que hay que sacar antes de comparar, y la clave es
 * el App Secret de la app de Meta, no una clave arbitraria propia.
 *
 * Referencia: https://developers.facebook.com/docs/graph-api/webhooks/getting-started#validating-payloads
 */
export function verifyMetaSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  appSecret: string | undefined,
): boolean {
  if (!appSecret) {
    return true;
  }
  if (!signatureHeader?.startsWith(SIGNATURE_PREFIX)) {
    return false;
  }

  const receivedHex = signatureHeader.slice(SIGNATURE_PREFIX.length);
  const expectedHex = createHmac("sha256", appSecret).update(rawBody).digest("hex");

  // Comparación en tiempo constante para no filtrar la firma esperada por timing.
  // Si el largo no matchea, timingSafeEqual tira; por eso se chequea antes.
  const expectedBuf = Buffer.from(expectedHex, "hex");
  const receivedBuf = Buffer.from(receivedHex, "hex");
  if (expectedBuf.length !== receivedBuf.length) {
    return false;
  }

  return timingSafeEqual(expectedBuf, receivedBuf);
}
