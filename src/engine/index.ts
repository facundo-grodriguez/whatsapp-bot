import { env } from "../config/env.js";
import { AiEngine } from "./aiEngine.js";
import { HybridEngine } from "./hybridEngine.js";
import { RulesEngine } from "./rulesEngine.js";
import type { ResponseEngine } from "./types.js";

/**
 * Punto único de selección del motor de decisión (Fase 4). Las reglas por
 * keywords siguen siendo la primera línea de decisión; la IA (OpenAI vía Vercel
 * AI SDK) entra solo como fallback cuando ninguna regla matchea, y solo si
 * AI_FALLBACK_ENABLED=true — sin eso, el comportamiento es idéntico a la Fase 1.
 */
const rulesEngine = new RulesEngine();
const aiEngine = env.AI_FALLBACK_ENABLED ? new AiEngine() : null;

export const engine: ResponseEngine = new HybridEngine(rulesEngine, aiEngine);

export type { Decision, DecisionContext, ResponseEngine } from "./types.js";
