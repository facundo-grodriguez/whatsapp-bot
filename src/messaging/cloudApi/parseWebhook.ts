import type { IgnoredEntry, InboundMessage, ParsedWebhook, StatusUpdate } from "../types.js";
import { DELIVERY_STATUSES } from "../types.js";
import {
  metaChangeEnvelopeSchema,
  metaChangeValueSchema,
  metaContactSchema,
  metaEntrySchema,
  metaMessageSchema,
  metaStatusSchema,
  metaWebhookEnvelopeSchema,
  type MetaChangeValue,
} from "./schemas.js";

/** `timestamp` de Meta es un string de segundos unix. `null` si falta o no es un número finito. */
function parseTimestamp(raw: string | undefined): Date | null {
  if (!raw) return null;
  const seconds = Number(raw);
  return Number.isFinite(seconds) ? new Date(seconds * 1000) : null;
}

function findSenderName(contactsRaw: unknown[] | undefined, waId: string): string | null {
  if (!contactsRaw) return null;
  for (const raw of contactsRaw) {
    const parsed = metaContactSchema.safeParse(raw);
    if (parsed.success && parsed.data.wa_id === waId) {
      return parsed.data.profile?.name ?? null;
    }
  }
  return null;
}

function parseMessages(
  value: MetaChangeValue,
  channelId: string,
  ignored: IgnoredEntry[],
): InboundMessage[] {
  const result: InboundMessage[] = [];

  for (const raw of value.messages ?? []) {
    const parsed = metaMessageSchema.safeParse(raw);
    if (!parsed.success) {
      ignored.push({ reason: "invalid_payload", detail: "message" });
      continue;
    }
    const message = parsed.data;

    if (message.type !== "text") {
      ignored.push({ reason: "unsupported_type", detail: message.type });
      continue;
    }

    const body = message.text?.body?.trim() ?? "";
    if (body === "") {
      ignored.push({ reason: "empty_body" });
      continue;
    }

    result.push({
      providerMessageId: message.id,
      channelId,
      chatId: message.from,
      senderName: findSenderName(value.contacts, message.from),
      body,
      timestamp: parseTimestamp(message.timestamp),
    });
  }

  return result;
}

function parseStatuses(
  value: MetaChangeValue,
  channelId: string,
  ignored: IgnoredEntry[],
): StatusUpdate[] {
  const result: StatusUpdate[] = [];

  for (const raw of value.statuses ?? []) {
    const parsed = metaStatusSchema.safeParse(raw);
    if (!parsed.success) {
      ignored.push({ reason: "invalid_payload", detail: "status" });
      continue;
    }
    const status = parsed.data;

    if (!DELIVERY_STATUSES.includes(status.status as (typeof DELIVERY_STATUSES)[number])) {
      ignored.push({ reason: "invalid_payload", detail: `status:${status.status}` });
      continue;
    }

    const firstError = status.errors?.[0];
    result.push({
      providerMessageId: status.id,
      channelId,
      chatId: status.recipient_id,
      status: status.status as (typeof DELIVERY_STATUSES)[number],
      timestamp: parseTimestamp(status.timestamp),
      errorCode: firstError?.code ?? null,
      errorTitle: firstError?.title ?? null,
    });
  }

  return result;
}

/**
 * Normaliza UNA request HTTP del webhook de Meta. Pura, determinista, NUNCA
 * tira: cualquier forma inesperada, a cualquier nivel de anidamiento, se
 * registra en `ignored` y se sigue procesando el resto — el webhook siempre
 * tiene que poder responder 200 (ver src/webhook/routes.ts).
 */
export function parseWebhook(payload: unknown): ParsedWebhook {
  const messages: InboundMessage[] = [];
  const statuses: StatusUpdate[] = [];
  const ignored: IgnoredEntry[] = [];

  const envelope = metaWebhookEnvelopeSchema.safeParse(payload);
  if (!envelope.success) {
    return { messages, statuses, ignored: [{ reason: "invalid_payload", detail: "envelope" }] };
  }

  for (const rawEntry of envelope.data.entry ?? []) {
    const entry = metaEntrySchema.safeParse(rawEntry);
    if (!entry.success) {
      ignored.push({ reason: "invalid_payload", detail: "entry" });
      continue;
    }

    for (const rawChange of entry.data.changes ?? []) {
      const change = metaChangeEnvelopeSchema.safeParse(rawChange);
      if (!change.success) {
        ignored.push({ reason: "invalid_payload", detail: "change" });
        continue;
      }

      if (change.data.field !== "messages") {
        ignored.push({ reason: "unknown_field", detail: change.data.field });
        continue;
      }

      const value = metaChangeValueSchema.safeParse(change.data.value);
      if (!value.success) {
        ignored.push({ reason: "invalid_payload", detail: "change.value" });
        continue;
      }

      const channelId = value.data.metadata.phone_number_id;
      messages.push(...parseMessages(value.data, channelId, ignored));
      statuses.push(...parseStatuses(value.data, channelId, ignored));
    }
  }

  return { messages, statuses, ignored };
}
