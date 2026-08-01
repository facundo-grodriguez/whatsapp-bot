import { CATEGORY_SIN_MATCH } from "../config/categories.js";
import { FALLBACK_MESSAGES } from "../config/messages.js";
import { PURCHASE_INTENT_RULE } from "../config/purchaseIntent.js";
import { FAQ_RULES } from "../config/rules.js";
import { matchesAnyPhrase } from "./matcher.js";
import { tokenize } from "./normalize.js";
import type { Decision, DecisionContext, ResponseEngine } from "./types.js";
import { pickRandom } from "./variant.js";

/**
 * Motor de la Fase 1: matching de reglas por palabras clave, sin IA. Implementa
 * ResponseEngine para poder reemplazarse por un motor con LLM en la Fase 4 sin
 * tocar el webhook, la cola ni el orquestador.
 */
export class RulesEngine implements ResponseEngine {
  // No hay ningún `await` adentro: el matching de reglas es síncrono. El método
  // es `async` igual porque así lo exige la interfaz ResponseEngine (ver types.ts).
  async decidirRespuesta(mensaje: string, _contexto: DecisionContext): Promise<Decision> {
    const tokens = tokenize(mensaje);

    // La intención de compra se evalúa primero: un mensaje como "¿cuál es el precio,
    // quiero comprar?" debe derivarse a un vendedor, no responderse como FAQ.
    if (matchesAnyPhrase(tokens, PURCHASE_INTENT_RULE.keywords)) {
      return {
        respuesta: pickRandom(PURCHASE_INTENT_RULE.responses),
        categoria: PURCHASE_INTENT_RULE.category,
        esIntencionCompra: true,
        requiereRevisionHumana: false,
      };
    }

    const faqMatch = FAQ_RULES.find((rule) => matchesAnyPhrase(tokens, rule.keywords));
    if (faqMatch) {
      return {
        respuesta: pickRandom(faqMatch.responses),
        categoria: faqMatch.category,
        esIntencionCompra: false,
        requiereRevisionHumana: false,
      };
    }

    return {
      respuesta: pickRandom(FALLBACK_MESSAGES),
      categoria: CATEGORY_SIN_MATCH,
      esIntencionCompra: false,
      requiereRevisionHumana: true,
    };
  }
}
