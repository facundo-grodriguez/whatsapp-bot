import { z } from "zod";

/**
 * Schema del payload de un mensaje dentro del evento "message" de WAHA.
 * `.passthrough()` porque WAHA manda más campos de los que usamos (media, vCards,
 * _data, etc.) y no queremos que el webhook rompa si agregan campos nuevos.
 *
 * Referencia: https://waha.devlike.pro/docs/how-to/events/
 */
export const wahaMessagePayloadSchema = z
  .object({
    id: z.string(),
    timestamp: z.number(),
    from: z.string(),
    fromMe: z.boolean(),
    to: z.string().optional(),
    body: z.string().default(""),
    hasMedia: z.boolean().optional(),
    participant: z.string().nullable().optional(),
  })
  .passthrough();

/** Schema del evento completo que WAHA envía al webhook configurado. */
export const wahaWebhookEventSchema = z
  .object({
    event: z.string(),
    session: z.string(),
    payload: wahaMessagePayloadSchema,
  })
  .passthrough();

export type WahaMessagePayload = z.infer<typeof wahaMessagePayloadSchema>;
export type WahaWebhookEvent = z.infer<typeof wahaWebhookEventSchema>;
