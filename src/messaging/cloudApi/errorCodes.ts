/**
 * Clasificación de códigos de error de la Graph API de Meta: si tiene sentido
 * reintentar el mismo envío o no. Lista corta a propósito — solo los códigos que
 * de verdad cambian el comportamiento (ver sendTextWithRetry en
 * conversation/handleIncomingMessage.ts); cualquier código no listado se trata
 * como reintentable por default (más seguro asumir que puede ser un blip
 * transitorio que dejar de reintentar algo que sí se hubiera recuperado).
 *
 * Referencia: https://developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 */
const NON_RETRYABLE_CODES = new Set<number>([
  190, // Token de acceso vencido o inválido — reintentar con el mismo token nunca funciona.
  131047, // Ventana de 24h cerrada: hace falta una plantilla aprobada, no texto libre.
  131009, // Parámetro inválido en el request — el mismo body va a fallar siempre igual.
  131026, // Mensaje no entregable (ej. número no tiene WhatsApp) — no es transitorio.
]);

export function isRetryableErrorCode(code: number | undefined): boolean {
  if (code === undefined) return true;
  return !NON_RETRYABLE_CODES.has(code);
}
