export interface FaqRule {
  /** Slug de categoría, se persiste en `messages.category` (ver src/db/schema.ts). */
  category: string;
  categoryLabel: string;
  /** Frases o palabras que activan esta regla. Se matchean por tokens (ver src/engine/matcher.ts). */
  keywords: string[];
  /** Variantes de respuesta; se elige una al azar (ver engine/variant.ts) para no repetir siempre el mismo texto. */
  responses: string[];
}

/**
 * FAQs de PrintLab 3D (impresión 3D), cargadas el 2026-08-04 para que el usuario
 * pruebe el bot con un rubro real en vez de las FAQs de ejemplo genéricas de las
 * Fases 1-5. Sigue siendo contenido de prueba/demo (no un negocio real todavía),
 * pero ya específico del rubro — reemplazar por las FAQs reales del negocio
 * cuando existan (ver instrucciones en README.md). El orden importa: la primera
 * regla que matchea gana.
 */
export const FAQ_RULES: FaqRule[] = [
  {
    category: "horarios",
    categoryLabel: "Horarios de atención",
    keywords: ["horario", "horarios", "a que hora abren", "atienden"],
    responses: [
      "Trabajamos de lunes a viernes de 10 a 19hs, y sábados de 10 a 14hs.",
      "Nuestro horario es de lunes a viernes de 10 a 19hs, y los sábados de 10 a 14hs.",
    ],
  },
  {
    category: "ubicacion",
    categoryLabel: "Ubicación",
    keywords: ["donde estan", "donde queda", "direccion", "ubicacion"],
    responses: [
      "Estamos en Av. Rivadavia 4820. Podés retirar tu pedido ahí o coordinamos el envío.",
      "Nuestro taller está en Av. Rivadavia 4820 — retiro en el local o te lo mandamos por correo.",
    ],
  },
  {
    category: "materiales",
    categoryLabel: "Materiales",
    keywords: [
      "en que material imprimen",
      "trabajan con resina",
      "tienen filamento",
      "que materiales usan",
      "imprimen en pla",
    ],
    responses: [
      "Imprimimos en PLA, PETG y resina, en varios colores. Contanos qué pieza necesitás y te decimos cuál conviene.",
      "Trabajamos con PLA, PETG y resina. El material ideal depende de la pieza — preguntanos y te asesoramos.",
    ],
  },
  {
    category: "archivos",
    categoryLabel: "Formatos de archivo",
    keywords: [
      "que formato de archivo",
      "aceptan stl",
      "mandan el diseño en obj",
      "no tengo el diseño",
    ],
    responses: [
      "Aceptamos archivos STL y OBJ. Si no tenés el diseño, también podemos ayudarte a modelarlo.",
      "Podés mandarnos el archivo en STL u OBJ. Si no tenés el modelo 3D todavía, lo armamos nosotros.",
    ],
  },
  {
    category: "tiempos_entrega",
    categoryLabel: "Tiempos de entrega",
    keywords: ["cuanto tarda", "en cuanto tiempo esta lista", "tiempo de entrega"],
    responses: [
      "Depende del tamaño de la pieza, pero la mayoría de los trabajos están listos en 2 a 4 días hábiles.",
      "El tiempo varía según la pieza — en general entregamos entre 2 y 4 días hábiles.",
    ],
  },
  {
    category: "envios",
    categoryLabel: "Envíos",
    keywords: ["hacen envios", "envian", "mandan a domicilio"],
    responses: [
      "Sí, mandamos por correo a todo el país.",
      "Sí, hacemos envíos a todo el país por correo.",
    ],
  },
  {
    category: "metodos_pago",
    categoryLabel: "Métodos de pago",
    keywords: ["medios de pago", "aceptan tarjeta", "puedo pagar con transferencia"],
    responses: [
      "Aceptamos efectivo, transferencia y tarjeta de crédito o débito.",
      "Podés pagar en efectivo, por transferencia o con tarjeta de crédito o débito.",
    ],
  },
  {
    // Última a propósito: si el mensaje además trae una consulta puntual (ej.
    // "hola, ¿cuál es el horario?"), esa regla más específica matchea primero
    // porque FAQ_RULES.find recorre el array en orden — esta solo gana cuando
    // el mensaje es un saludo solo, sin ninguna consulta reconocible.
    category: "saludo",
    categoryLabel: "Saludo",
    keywords: ["hola", "buenas", "buen dia", "buenos dias", "buenas tardes", "buenas noches", "que tal"],
    responses: [
      "¡Hola! ¿En qué te podemos ayudar? Contanos qué necesitás y te respondemos al toque.",
      "¡Hola! Gracias por escribirnos. ¿En qué te podemos ayudar hoy?",
    ],
  },
];
