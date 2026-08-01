/**
 * Throttle en memoria para el modo degradado (Fase 3): evita mandar el mensaje
 * de resguardo más de una vez por chat dentro de la ventana configurada.
 *
 * Es crítico que esto viva en memoria, no en la base: el escenario típico en el
 * que se activa el modo degradado es justamente que la base (u otra dependencia)
 * está fallando, así que no podemos depender de ella para decidir si ya
 * respondimos. El costo es que el throttle se resetea si el proceso reinicia —
 * aceptado: preferible a que un cliente reciba diez veces el mismo mensaje
 * mientras hay una falla en curso, que es la señal de automatización más obvia
 * que existe.
 */

const THROTTLE_WINDOW_MS = 5 * 60 * 1000;

const lastDegradedReplyAt = new Map<string, number>();

function throttleKey(sessionName: string, chatId: string): string {
  return `${sessionName}:${chatId}`;
}

/**
 * ¿Ya se le mandó un mensaje degradado a este chat dentro de la ventana? Si la
 * respuesta es `false`, además registra el intento actual (para que la próxima
 * consulta dentro de la ventana sí se frene).
 */
export function shouldSendDegradedReply(sessionName: string, chatId: string): boolean {
  const key = throttleKey(sessionName, chatId);
  const lastSentAt = lastDegradedReplyAt.get(key);
  const now = Date.now();

  if (lastSentAt !== undefined && now - lastSentAt < THROTTLE_WINDOW_MS) {
    return false;
  }

  lastDegradedReplyAt.set(key, now);
  return true;
}
