import { env } from "../../config/env.js";
import type {
  MarkReadAndTypingInput,
  MessagingProvider,
  ParsedWebhook,
  SendTextInput,
  SendTextResult,
} from "../types.js";
import { markReadAndTyping as markReadAndTypingImpl, sendText as sendTextImpl } from "./client.js";
import { parseWebhook as parseWebhookImpl } from "./parseWebhook.js";
import { verifyMetaSignature } from "./signature.js";

/** Implementación de MessagingProvider contra la Cloud API de Meta. */
export class CloudApiProvider implements MessagingProvider {
  readonly name = "cloud-api";

  sendText(input: SendTextInput): Promise<SendTextResult> {
    return sendTextImpl(input);
  }

  markReadAndTyping(input: MarkReadAndTypingInput): Promise<void> {
    return markReadAndTypingImpl(input);
  }

  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined): boolean {
    return verifyMetaSignature(rawBody, signatureHeader, env.META_APP_SECRET);
  }

  parseWebhook(payload: unknown): ParsedWebhook {
    return parseWebhookImpl(payload);
  }
}
