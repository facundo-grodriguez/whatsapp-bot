import { describe, expect, it } from "vitest";

import { CATEGORY_SIN_MATCH } from "../../src/config/categories.js";
import { HybridEngine } from "../../src/engine/hybridEngine.js";
import type { Decision, DecisionContext, ResponseEngine } from "../../src/engine/types.js";

const baseContext: DecisionContext = {
  channelId: "default",
  chatId: "5491111111111@c.us",
  state: "activa",
  history: [],
};

function fakeEngine(decision: Decision): ResponseEngine {
  return { decidirRespuesta: async () => decision };
}

const rulesMatchDecision: Decision = {
  respuesta: "Atendemos de lunes a viernes de 9 a 18hs.",
  categoria: "horarios",
  esIntencionCompra: false,
  requiereRevisionHumana: false,
};

const rulesSinMatchDecision: Decision = {
  respuesta: "¡Gracias por escribirnos!",
  categoria: CATEGORY_SIN_MATCH,
  esIntencionCompra: false,
  requiereRevisionHumana: true,
};

describe("HybridEngine", () => {
  it("devuelve la decisión de reglas si matchea, sin llamar a la IA", async () => {
    let aiCalled = false;
    const ai: ResponseEngine = {
      decidirRespuesta: async () => {
        aiCalled = true;
        return rulesSinMatchDecision;
      },
    };

    const hybrid = new HybridEngine(fakeEngine(rulesMatchDecision), ai);
    const decision = await hybrid.decidirRespuesta("¿horario?", baseContext);

    expect(decision).toBe(rulesMatchDecision);
    expect(aiCalled).toBe(false);
  });

  it("delega en la IA cuando las reglas no matchean nada", async () => {
    const aiDecision: Decision = {
      respuesta: "Sí, hacemos envíos a todo el país los fines de semana también.",
      categoria: "envios",
      esIntencionCompra: false,
      requiereRevisionHumana: false,
    };

    const hybrid = new HybridEngine(fakeEngine(rulesSinMatchDecision), fakeEngine(aiDecision));
    const decision = await hybrid.decidirRespuesta(
      "¿mandan a domicilio los fines de semana?",
      baseContext,
    );

    expect(decision).toBe(aiDecision);
  });

  it("prioriza la intención de compra de las reglas y ni siquiera evalúa la IA", async () => {
    const purchaseDecision: Decision = {
      respuesta: "¡Perfecto! Ya te conecto con alguien de ventas.",
      categoria: "intencion_compra",
      esIntencionCompra: true,
      requiereRevisionHumana: false,
    };
    let aiCalled = false;
    const ai: ResponseEngine = {
      decidirRespuesta: async () => {
        aiCalled = true;
        return rulesSinMatchDecision;
      },
    };

    const hybrid = new HybridEngine(fakeEngine(purchaseDecision), ai);
    const decision = await hybrid.decidirRespuesta("quiero comprar", baseContext);

    expect(decision.esIntencionCompra).toBe(true);
    expect(aiCalled).toBe(false);
  });

  it("usa el fallback de reglas si no hay motor de IA configurado (AI_FALLBACK_ENABLED=false)", async () => {
    const hybrid = new HybridEngine(fakeEngine(rulesSinMatchDecision), null);
    const decision = await hybrid.decidirRespuesta("asdf qwerty zzz", baseContext);

    expect(decision).toBe(rulesSinMatchDecision);
  });
});
