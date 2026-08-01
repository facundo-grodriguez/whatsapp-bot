import { DERIVATION_MESSAGE } from "./messages.js";

/**
 * Palabras/frases que indican intención de compra. Si matchean, el bot deja de
 * autoresponder (conversación pasa a "derivada") y se llama a notifyVendor().
 * Ver instrucciones de personalización en README.md.
 */
export const PURCHASE_INTENT_RULE = {
  category: "intencion_compra",
  categoryLabel: "Intención de compra",
  response: DERIVATION_MESSAGE,
  keywords: [
    "comprar",
    "quiero comprar",
    "precio",
    "cual es el precio",
    "cuanto sale",
    "como pago",
    "quiero hacer un pedido",
  ],
};
