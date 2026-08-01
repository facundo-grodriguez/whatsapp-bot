import { PURCHASE_INTENT_RULE } from "./purchaseIntent.js";
import { FAQ_RULES } from "./rules.js";

/** Categoría de mensajes que no matchearon ninguna regla; quedan para revisión humana. */
export const CATEGORY_SIN_MATCH = "sin_match";

/**
 * Catálogo completo de categorías, derivado de las reglas configuradas. Es la
 * fuente única de verdad: se usa para poblar `categories` (FK de messages.category)
 * en cada arranque del servidor, así nunca queda desalineado con las reglas.
 */
export const CATEGORIES = [
  ...FAQ_RULES.map((rule) => ({ slug: rule.category, label: rule.categoryLabel })),
  { slug: PURCHASE_INTENT_RULE.category, label: PURCHASE_INTENT_RULE.categoryLabel },
  { slug: CATEGORY_SIN_MATCH, label: "Sin match (revisión humana)" },
];
