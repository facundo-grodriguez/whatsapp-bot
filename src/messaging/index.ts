import { CloudApiProvider } from "./cloudApi/provider.js";
import type { MessagingProvider } from "./types.js";

/**
 * Punto único de selección del proveedor de mensajería (mismo patrón que
 * src/engine/index.ts para el motor de decisión). Hoy la única implementación
 * es la Cloud API de Meta; el resto del sistema depende solo de la interfaz
 * MessagingProvider, nunca de CloudApiProvider directamente.
 */
export const messaging: MessagingProvider = new CloudApiProvider();

export type {
  DeliveryStatus,
  IgnoredEntry,
  IgnoredReason,
  InboundMessage,
  MarkReadAndTypingInput,
  MessagingProvider,
  ParsedWebhook,
  SendTextInput,
  SendTextResult,
  StatusUpdate,
} from "./types.js";
export { MessagingError } from "./errors.js";
