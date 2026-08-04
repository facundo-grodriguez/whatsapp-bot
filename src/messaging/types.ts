/**
 * Contrato del proveedor de mensajería. Hoy la única implementación es la Cloud
 * API de Meta (ver cloudApi/), pero la interfaz existe por la misma razón que
 * ResponseEngine en /engine (ver src/engine/types.ts): aislar al resto del
 * sistema del proveedor concreto, y poder testear el parseo de webhooks sin red.
 *
 * Reglas de diseño (mismo criterio que engine/types.ts — no relajar sin
 * actualizar CLAUDE.md):
 * 1. Este archivo no importa nada de `config/`, `db/` ni hace fetch — solo tipos.
 * 2. `channelId` es "cuál de nuestros números" (del lado de Meta, el
 *    phone_number_id); `chatId` es "con quién hablamos". Se mantiene el nombre
 *    `channelId` neutro — igual que `sessionName` no debía filtrar conceptos de
 *    WAHA hacia el motor, `channelId` no debe filtrar conceptos de Meta.
 * 3. `parseWebhook` es pura y NUNCA tira: un payload irreconocible devuelve
 *    listas vacías, porque el webhook siempre debe responder 200 (el proveedor
 *    reintenta ante cualquier otra cosa, potencialmente para siempre).
 */

/** Mensaje entrante ya normalizado, sin conceptos del proveedor concreto. */
export interface InboundMessage {
  /** Id del mensaje del lado del proveedor. Base de la idempotencia del webhook. */
  providerMessageId: string;
  /** Cuál de nuestros números lo recibió. */
  channelId: string;
  /** Quién escribió. */
  chatId: string;
  /** Nombre de perfil de WhatsApp, si el proveedor lo mandó. */
  senderName: string | null;
  /** Texto plano, ya garantizado no vacío por el parser. */
  body: string;
  /** Momento del mensaje según el proveedor, o null si no vino o no es parseable. */
  timestamp: Date | null;
}

export const DELIVERY_STATUSES = ["sent", "delivered", "read", "failed"] as const;
export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

/** Acuse de estado de un mensaje que enviamos nosotros (no un mensaje del cliente). */
export interface StatusUpdate {
  providerMessageId: string;
  channelId: string;
  chatId: string;
  status: DeliveryStatus;
  timestamp: Date | null;
  /** Solo tienen sentido cuando status === "failed". */
  errorCode: number | null;
  errorTitle: string | null;
}

export type IgnoredReason =
  | "invalid_payload" // el sobre no tiene la forma esperada
  | "unknown_field" // ej. un "change" que no es de mensajes (plantillas, etc.)
  | "unsupported_type" // no es texto (imagen, audio, ubicación, ...)
  | "empty_body"; // texto en blanco

export interface IgnoredEntry {
  reason: IgnoredReason;
  /** Contexto para logs/tests (ej. el `type` recibido). Nunca contenido del cliente. */
  detail?: string;
}

/**
 * Resultado de parsear UNA request HTTP del webhook. Es una lista a propósito:
 * a diferencia de WAHA (un evento por request), el proveedor puede empaquetar
 * varios mensajes de chats distintos, más varios acuses de estado, en una sola
 * entrega.
 */
export interface ParsedWebhook {
  messages: InboundMessage[];
  statuses: StatusUpdate[];
  /** Lo que se reconoció pero se descartó, con el motivo. Para logs y tests. */
  ignored: IgnoredEntry[];
}

export interface SendTextInput {
  channelId: string;
  chatId: string;
  text: string;
}

export interface SendTextResult {
  /** Id del mensaje enviado del lado del proveedor. Permite correlacionar los
   *  StatusUpdate que lleguen después. `null` en dry-run. */
  providerMessageId: string | null;
}

export interface MarkReadAndTypingInput {
  channelId: string;
  /** Id del mensaje ENTRANTE que se marca como leído. */
  providerMessageId: string;
  /** Si además debe mostrarse el indicador de "escribiendo…". */
  showTyping: boolean;
}

export interface MessagingProvider {
  readonly name: string;

  /** Envía texto libre. Tira MessagingError si falla. */
  sendText(input: SendTextInput): Promise<SendTextResult>;

  /**
   * Marca como leído y, opcionalmente, muestra "escribiendo…". Es UNA sola
   * llamada porque así lo modela la Cloud API: no existe un "stopTyping" — el
   * indicador se apaga solo al llegar el mensaje (o a los 25s). Cosmético:
   * nunca tira, igual que startTyping/stopTyping en el WAHA client que reemplaza.
   */
  markReadAndTyping(input: MarkReadAndTypingInput): Promise<void>;

  /** Verifica la firma del webhook sobre los bytes EXACTOS recibidos. */
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean;

  /** Normaliza el payload crudo del webhook. Pura, determinista, nunca tira. */
  parseWebhook(payload: unknown): ParsedWebhook;
}
