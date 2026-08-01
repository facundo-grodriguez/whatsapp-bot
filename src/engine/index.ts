import { RulesEngine } from "./rulesEngine.js";
import type { ResponseEngine } from "./types.js";

/**
 * Punto único de selección del motor de decisión. En la Fase 4, este archivo es
 * lo único que cambia para pasar de reglas a IA: se reemplaza `new RulesEngine()`
 * por la implementación con el AI SDK, sin tocar webhook/orquestador/DB.
 */
export const engine: ResponseEngine = new RulesEngine();

export type { Decision, DecisionContext, ResponseEngine } from "./types.js";
