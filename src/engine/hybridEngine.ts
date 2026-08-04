import { CATEGORY_SIN_MATCH } from "../config/categories.js";
import type { Decision, DecisionContext, ResponseEngine } from "./types.js";

/**
 * Motor de la Fase 4: compone RulesEngine + AiEngine sin reemplazar ninguno de
 * los dos. Las reglas por keywords siguen decidiendo la intención de compra y las
 * FAQs con match exacto (rápido, gratis, determinístico); la IA solo entra como
 * fallback cuando las reglas no matchean nada, en vez de ir directo al mensaje
 * genérico fijo.
 *
 * `aiEngine` es `null` cuando AI_FALLBACK_ENABLED=false (ver src/config/env.ts):
 * en ese caso el comportamiento es exactamente el de la Fase 1, sin costo ni
 * dependencia de OpenAI.
 */
export class HybridEngine implements ResponseEngine {
  constructor(
    private readonly rulesEngine: ResponseEngine,
    private readonly aiEngine: ResponseEngine | null,
  ) {}

  async decidirRespuesta(mensaje: string, contexto: DecisionContext): Promise<Decision> {
    const rulesDecision = await this.rulesEngine.decidirRespuesta(mensaje, contexto);

    if (rulesDecision.categoria !== CATEGORY_SIN_MATCH || !this.aiEngine) {
      return rulesDecision;
    }

    return this.aiEngine.decidirRespuesta(mensaje, contexto);
  }
}
