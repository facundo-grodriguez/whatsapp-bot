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
