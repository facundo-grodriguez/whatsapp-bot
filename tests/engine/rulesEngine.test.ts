import { describe, expect, it } from "vitest";

import { CATEGORY_SIN_MATCH } from "../../src/config/categories.js";
import { DERIVATION_MESSAGE, FALLBACK_MESSAGE } from "../../src/config/messages.js";
import { PURCHASE_INTENT_RULE } from "../../src/config/purchaseIntent.js";
import { RulesEngine } from "../../src/engine/rulesEngine.js";
import type { DecisionContext } from "../../src/engine/types.js";

const baseContext: DecisionContext = {
  sessionName: "default",
  chatId: "5491111111111@c.us",
  state: "activa",
  history: [],
};

describe("RulesEngine", () => {
  const engine = new RulesEngine();

  it("responde una FAQ configurada (horarios)", async () => {
    const decision = await engine.decidirRespuesta("¿cuál es el horario?", baseContext);

    expect(decision).toEqual({
      respuesta: "Atendemos de lunes a viernes de 9 a 18hs.",
      categoria: "horarios",
      esIntencionCompra: false,
      requiereRevisionHumana: false,
    });
  });

  it("detecta intención de compra y marca derivación", async () => {
    const decision = await engine.decidirRespuesta("hola, quiero comprar", baseContext);

    expect(decision).toEqual({
      respuesta: DERIVATION_MESSAGE,
      categoria: PURCHASE_INTENT_RULE.category,
      esIntencionCompra: true,
      requiereRevisionHumana: false,
    });
  });

  it("prioriza intención de compra sobre una FAQ si ambas matchean", async () => {
    // "precio" es keyword de intención de compra (ver config/purchaseIntent.ts),
    // no una FAQ propia: el mensaje debe derivarse, no responderse como FAQ.
    const decision = await engine.decidirRespuesta("¿cuál es el precio?", baseContext);

    expect(decision.esIntencionCompra).toBe(true);
    expect(decision.categoria).toBe(PURCHASE_INTENT_RULE.category);
  });

  it("responde el mensaje genérico y pide revisión humana si no matchea nada", async () => {
    const decision = await engine.decidirRespuesta("asdf qwerty zzz", baseContext);

    expect(decision).toEqual({
      respuesta: FALLBACK_MESSAGE,
      categoria: CATEGORY_SIN_MATCH,
      esIntencionCompra: false,
      requiereRevisionHumana: true,
    });
  });

  it("no depende del estado de la conversación para decidir (esa lógica es del orquestador)", async () => {
    const derivada = await engine.decidirRespuesta("¿cuál es el horario?", {
      ...baseContext,
      state: "derivada",
    });

    expect(derivada.respuesta).toBe("Atendemos de lunes a viernes de 9 a 18hs.");
  });
});
