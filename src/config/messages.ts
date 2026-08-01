/**
 * Variantes del mensaje de resguardo cuando ninguna regla matchea. Se elige una al
 * azar (ver engine/variant.ts) para no repetir siempre el mismo texto exacto ante
 * usuarios distintos. Se marca para revisión humana.
 */
export const FALLBACK_MESSAGES = [
  "¡Gracias por escribirnos! Ya registramos tu consulta y en breve te responde alguien del equipo.",
  "¡Recibimos tu mensaje! En breve te responde alguien del equipo.",
];

/** Variantes del mensaje que avisa la derivación cuando se detecta intención de compra. */
export const DERIVATION_MESSAGES = [
  "¡Genial! Te paso con alguien del equipo de ventas para ayudarte. En breve te contactan por acá.",
  "¡Perfecto! Ya te conecto con alguien de ventas. En breve te escriben por acá.",
];

/**
 * Mensaje de resguardo del modo degradado (Fase 3): se manda cuando algo interno
 * falla (motor, base de datos, etc.) y el bot no puede procesar el mensaje con
 * normalidad. Es una sola variante fija a propósito: en un escenario de falla es
 * más importante que el texto sea simple y confiable que variado.
 */
export const DEGRADED_MODE_MESSAGE =
  "Recibimos tu consulta, en breve te contactamos. Gracias por tu paciencia.";
