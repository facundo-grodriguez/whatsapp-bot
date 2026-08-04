import { z } from "zod";

/**
 * Schemas del payload que manda el webhook de la Cloud API de Meta.
 *
 * Deliberadamente en capas finas (envelope -> entry -> change -> value ->
 * message/status), cada una con `.passthrough()` (Meta manda más campos de los
 * que usamos: reactions, contexto de respuesta, etc.) y validada por separado en
 * parseWebhook.ts — así un solo mensaje/status/change con forma inesperada no
 * tira todo el lote: el resto de un batch grande se sigue procesando igual.
 *
 * Referencia: https://developers.facebook.com/docs/whatsapp/cloud-api/webhooks/payload-examples
 */

/** Envoltorio de nivel más alto: solo lo mínimo para saber si hay algo que iterar. */
export const metaWebhookEnvelopeSchema = z
  .object({
    object: z.string().optional(),
    entry: z.array(z.unknown()).optional(),
  })
  .passthrough();

export const metaEntrySchema = z
  .object({
    id: z.string().optional(),
    changes: z.array(z.unknown()).optional(),
  })
  .passthrough();

export const metaChangeEnvelopeSchema = z
  .object({
    field: z.string().optional(),
    value: z.unknown().optional(),
  })
  .passthrough();

export const metaChangeValueSchema = z
  .object({
    messaging_product: z.string().optional(),
    metadata: z
      .object({
        phone_number_id: z.string(),
        display_phone_number: z.string().optional(),
      })
      .passthrough(),
    contacts: z.array(z.unknown()).optional(),
    messages: z.array(z.unknown()).optional(),
    statuses: z.array(z.unknown()).optional(),
  })
  .passthrough();

export const metaContactSchema = z
  .object({
    wa_id: z.string(),
    profile: z.object({ name: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

/**
 * `timestamp` viaja como STRING de segundos unix (particularidad documentada de
 * Meta, no un error de tipeo) — se parsea a número en parseWebhook.ts.
 */
export const metaMessageSchema = z
  .object({
    id: z.string(),
    from: z.string(),
    timestamp: z.string().optional(),
    type: z.string(),
    text: z.object({ body: z.string().optional() }).passthrough().optional(),
  })
  .passthrough();

export const metaStatusErrorSchema = z
  .object({
    code: z.number().optional(),
    title: z.string().optional(),
  })
  .passthrough();

export const metaStatusSchema = z
  .object({
    id: z.string(),
    status: z.string(),
    timestamp: z.string().optional(),
    recipient_id: z.string(),
    errors: z.array(metaStatusErrorSchema).optional(),
  })
  .passthrough();

export type MetaEntry = z.infer<typeof metaEntrySchema>;
export type MetaChangeEnvelope = z.infer<typeof metaChangeEnvelopeSchema>;
export type MetaChangeValue = z.infer<typeof metaChangeValueSchema>;
export type MetaContact = z.infer<typeof metaContactSchema>;
export type MetaMessage = z.infer<typeof metaMessageSchema>;
export type MetaStatus = z.infer<typeof metaStatusSchema>;
