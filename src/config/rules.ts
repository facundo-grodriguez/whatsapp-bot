export interface FaqRule {
  /** Slug de categoría, se persiste en `messages.category` (ver src/db/schema.ts). */
  category: string;
  categoryLabel: string;
  /** Frases o palabras que activan esta regla. Se matchean por tokens (ver src/engine/matcher.ts). */
  keywords: string[];
  response: string;
}

/**
 * FAQs de ejemplo del negocio. Para cargar las propias: agregar/editar entradas
 * acá (ver instrucciones en README.md). El orden importa: la primera regla que
 * matchea gana.
 */
export const FAQ_RULES: FaqRule[] = [
  {
    category: "horarios",
    categoryLabel: "Horarios de atención",
    keywords: ["horario", "horarios", "a que hora abren", "atienden"],
    response: "Atendemos de lunes a viernes de 9 a 18hs.",
  },
  {
    category: "ubicacion",
    categoryLabel: "Ubicación",
    keywords: ["donde estan", "donde quedan", "direccion", "ubicacion"],
    response: "Estamos en Av. Siempre Viva 742. Nos encontrás en Google Maps buscando nuestro nombre.",
  },
  {
    category: "envios",
    categoryLabel: "Envíos",
    keywords: ["hacen envios", "envian", "delivery", "mandan a domicilio"],
    response: "Sí, hacemos envíos a todo el país.",
  },
  {
    category: "metodos_pago",
    categoryLabel: "Métodos de pago",
    keywords: ["medios de pago", "aceptan tarjeta", "puedo pagar con transferencia"],
    response: "Aceptamos efectivo, transferencia y tarjeta de crédito o débito.",
  },
];
