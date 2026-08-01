/**
 * Contrato del motor de decisión. Esta interfaz es el punto de reemplazo de la
 * Fase 4: cuando el motor de reglas se cambie por uno basado en IA (Vercel AI SDK),
 * la nueva implementación debe cumplir exactamente esta misma interfaz para que el
 * webhook, la cola y el orquestador no necesiten ningún cambio.
 *
 * Reglas de diseño (no relajar sin actualizar CLAUDE.md):
 * 1. `decidirRespuesta` es async aunque el motor de reglas sea síncrono por dentro.
 * 2. El motor NO tiene efectos secundarios: no envía mensajes, no escribe en la
 *    base, no notifica al vendedor. Solo devuelve una decisión.
 * 3. Este archivo no importa nada de `db/` ni de `waha/` — el motor debe poder
 *    testearse y reemplazarse sin conocer cómo se persisten los datos ni cómo se
 *    envían los mensajes.
 */

// Duplicado a propósito respecto de ConversationState en db/schema.ts: el motor
// no debe depender del esquema de la base de datos para mantenerse aislado.
export type ConversationState = "activa" | "derivada";

export interface HistoryMessage {
  direction: "inbound" | "outbound";
  body: string;
  createdAt: Date;
}

export interface DecisionContext {
  sessionName: string;
  chatId: string;
  state: ConversationState;
  /** Vacío en la Fase 1. El motor de IA de la Fase 4 lo va a necesitar para dar contexto al LLM. */
  history: HistoryMessage[];
}

export interface Decision {
  /** `null` significa "no responder" (por ejemplo, si la conversación ya está derivada). */
  respuesta: string | null;
  categoria: string;
  esIntencionCompra: boolean;
  requiereRevisionHumana: boolean;
}

export interface ResponseEngine {
  decidirRespuesta(mensaje: string, contexto: DecisionContext): Promise<Decision>;
}
