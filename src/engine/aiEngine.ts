import { openai } from "@ai-sdk/openai";
import { generateObject } from "ai";
import { z } from "zod";

import { CATEGORY_SIN_MATCH } from "../config/categories.js";
import { env } from "../config/env.js";
import { FALLBACK_MESSAGES } from "../config/messages.js";
import { FAQ_RULES } from "../config/rules.js";
import type { Decision, DecisionContext, ResponseEngine } from "./types.js";
import { pickRandom } from "./variant.js";

const REQUEST_TIMEOUT_MS = 15_000;

/** Error tipado para cualquier falla al hablar con la API de OpenAI (HTTP, timeout o red). */
export class AiEngineError extends Error {
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AiEngineError";
  }
}

const decisionSchema = z.object({
  puedeResponder: z
    .boolean()
    .describe(
      "true solo si la pregunta está cubierta por las FAQs dadas y podés responderla sin inventar nada",
    ),
  categoria: z
    .string()
    .describe(
      `Slug de la FAQ que mejor responde la pregunta (una de las provistas), o "${CATEGORY_SIN_MATCH}" si puedeResponder es false`,
    ),
  respuesta: z
    .string()
    .nullable()
    .describe("Respuesta en texto para el cliente, o null si puedeResponder es false"),
});

const SYSTEM_PROMPT = `Sos el asistente de primer contacto de un negocio por WhatsApp. Respondés
preguntas de clientes usando EXCLUSIVAMENTE la información de las FAQs que se te dan a
continuación — nunca inventes datos del negocio (precios, horarios, direcciones, stock, políticas)
que no estén ahí. Mantené el mismo tono cercano y breve que las respuestas de ejemplo. Si la
pregunta ya está resuelta por el historial de la conversación, no la repitas. Si la pregunta no
está cubierta por las FAQs, o no tenés información suficiente para responderla con certeza, marcá
puedeResponder: false — no arriesgues una respuesta incorrecta.`;

function buildFaqContext(): string {
  return FAQ_RULES.map(
    (rule) =>
      `- categoria: ${rule.category}\n  pregunta tipo: ${rule.keywords.join(", ")}\n  respuesta de ejemplo: ${rule.responses[0]}`,
  ).join("\n");
}

function buildHistoryContext(history: DecisionContext["history"]): string {
  if (history.length === 0) return "(sin mensajes previos)";
  return history
    .map((m) => `${m.direction === "inbound" ? "Cliente" : "Bot"}: ${m.body}`)
    .join("\n");
}

/**
 * Motor de la Fase 4: fallback con IA (Vercel AI SDK + OpenAI) para preguntas que
 * el RulesEngine no matcheó por keywords. No reemplaza al motor de reglas — lo
 * complementa (ver HybridEngine) y respeta la misma interfaz ResponseEngine para
 * no tocar webhook/orquestador/DB.
 *
 * Nunca inventa datos del negocio: solo responde con lo que está en las FAQs
 * configuradas (src/config/rules.ts). Si no puede responder con eso, devuelve el
 * mismo fallback fijo que el RulesEngine (requiereRevisionHumana: true) en vez de
 * dejar que el LLM redacte un texto de resguardo variable.
 */
export class AiEngine implements ResponseEngine {
  async decidirRespuesta(mensaje: string, contexto: DecisionContext): Promise<Decision> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const { object } = await generateObject({
        model: openai(env.OPENAI_MODEL),
        schema: decisionSchema,
        system: SYSTEM_PROMPT,
        prompt:
          `FAQs disponibles:\n${buildFaqContext()}\n\n` +
          `Historial reciente de esta conversación:\n${buildHistoryContext(contexto.history)}\n\n` +
          `Mensaje actual del cliente: "${mensaje}"`,
        abortSignal: controller.signal,
      });

      if (!object.puedeResponder || !object.respuesta) {
        return fallbackDecision();
      }

      return {
        respuesta: object.respuesta,
        categoria: object.categoria,
        esIntencionCompra: false,
        requiereRevisionHumana: false,
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new AiEngineError(`Timeout de ${REQUEST_TIMEOUT_MS}ms llamando a OpenAI`, error);
      }
      throw new AiEngineError("Error llamando a OpenAI", error);
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

function fallbackDecision(): Decision {
  return {
    respuesta: pickRandom(FALLBACK_MESSAGES),
    categoria: CATEGORY_SIN_MATCH,
    esIntencionCompra: false,
    requiereRevisionHumana: true,
  };
}
