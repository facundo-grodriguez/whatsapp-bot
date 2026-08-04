import { beforeEach, describe, expect, it, vi } from "vitest";

import { CATEGORY_SIN_MATCH } from "../../src/config/categories.js";
import { FALLBACK_MESSAGES } from "../../src/config/messages.js";
import { AiEngine, AiEngineError } from "../../src/engine/aiEngine.js";
import type { DecisionContext } from "../../src/engine/types.js";

const generateObjectMock = vi.hoisted(() => vi.fn());

vi.mock("ai", () => ({
  generateObject: generateObjectMock,
}));

vi.mock("@ai-sdk/openai", () => ({
  openai: vi.fn((model: string) => ({ modelId: model })),
}));

const baseContext: DecisionContext = {
  channelId: "default",
  chatId: "5491111111111@c.us",
  state: "activa",
  history: [],
};

describe("AiEngine", () => {
  beforeEach(() => {
    generateObjectMock.mockReset();
  });

  it("responde con el texto del LLM cuando puede responder usando las FAQs", async () => {
    generateObjectMock.mockResolvedValue({
      object: { puedeResponder: true, categoria: "horarios", respuesta: "Abrimos de 9 a 18." },
    });

    const engine = new AiEngine();
    const decision = await engine.decidirRespuesta("¿a qué hora abren los sábados?", baseContext);

    expect(decision).toEqual({
      respuesta: "Abrimos de 9 a 18.",
      categoria: "horarios",
      esIntencionCompra: false,
      requiereRevisionHumana: false,
    });
  });

  it("cae al fallback fijo (no al texto del LLM) cuando no puede responder", async () => {
    generateObjectMock.mockResolvedValue({
      object: { puedeResponder: false, categoria: CATEGORY_SIN_MATCH, respuesta: null },
    });

    const engine = new AiEngine();
    const decision = await engine.decidirRespuesta(
      "¿tienen stock de un repuesto rarísimo?",
      baseContext,
    );

    expect(FALLBACK_MESSAGES).toContain(decision.respuesta);
    expect(decision).toMatchObject({
      categoria: CATEGORY_SIN_MATCH,
      esIntencionCompra: false,
      requiereRevisionHumana: true,
    });
  });

  it("nunca marca intención de compra (esa decisión es solo de las reglas)", async () => {
    generateObjectMock.mockResolvedValue({
      object: { puedeResponder: true, categoria: "envios", respuesta: "Sí, enviamos." },
    });

    const engine = new AiEngine();
    const decision = await engine.decidirRespuesta("¿envían?", baseContext);

    expect(decision.esIntencionCompra).toBe(false);
  });

  it("envuelve errores de la API en AiEngineError en vez de dejarlos pasar crudos", async () => {
    generateObjectMock.mockRejectedValue(new Error("network down"));

    const engine = new AiEngine();

    await expect(engine.decidirRespuesta("hola", baseContext)).rejects.toThrow(AiEngineError);
  });
});
