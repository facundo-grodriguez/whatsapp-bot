import { and, eq, or } from "drizzle-orm";

import { db } from "../client.js";
import { type MessageDeliveryStatus, type MessageDirection, messages } from "../schema.js";

export type Message = typeof messages.$inferSelect;

export interface InsertInboundMessageInput {
  conversationId: number;
  providerMessageId: string;
  body: string;
  waTimestamp: Date | null;
}

/**
 * Inserta un mensaje entrante de forma idempotente: si `providerMessageId` ya
 * existe (reintento de webhook de Meta), no duplica la fila y devuelve `null`
 * para que el llamador sepa que no debe volver a encolar el procesamiento.
 */
export async function insertInboundMessageIfNew(
  input: InsertInboundMessageInput,
): Promise<Message | null> {
  const [inserted] = await db
    .insert(messages)
    .values({
      conversationId: input.conversationId,
      providerMessageId: input.providerMessageId,
      direction: "inbound" satisfies MessageDirection,
      body: input.body,
      waTimestamp: input.waTimestamp,
    })
    .onConflictDoNothing()
    .returning();

  return inserted ?? null;
}

export interface InsertOutboundMessageInput {
  conversationId: number;
  body: string;
  category: string | null;
  isPurchaseIntent: boolean;
  needsHumanReview: boolean;
  inReplyToId: number | null;
  /** Id del mensaje del lado de Meta (`wamid...`), para poder correlacionar los
   *  acuses de estado que lleguen después (ver updateDeliveryStatus). `null`/no
   *  provisto si el envío falló antes de conseguir uno, o en dry-run. */
  providerMessageId?: string | null;
}

export async function insertOutboundMessage(
  input: InsertOutboundMessageInput,
): Promise<Message> {
  const [inserted] = await db
    .insert(messages)
    .values({
      conversationId: input.conversationId,
      direction: "outbound" satisfies MessageDirection,
      body: input.body,
      category: input.category,
      isPurchaseIntent: input.isPurchaseIntent,
      needsHumanReview: input.needsHumanReview,
      inReplyToId: input.inReplyToId,
      providerMessageId: input.providerMessageId ?? null,
    })
    .returning();

  if (!inserted) {
    throw new Error("No se pudo insertar el mensaje saliente");
  }

  return inserted;
}

/**
 * Actualiza el último estado de entrega conocido de un mensaje SALIENTE, a
 * partir de un evento `statuses` del webhook (ver webhook/routes.ts). Sin
 * efecto si no hay ningún mensaje con ese `providerMessageId` — puede pasar si
 * el estado llega antes de que termine de persistirse el envío, o si es de un
 * mensaje que no rastreamos (no debería, pero no es motivo para tirar).
 */
export async function updateDeliveryStatus(
  providerMessageId: string,
  status: MessageDeliveryStatus,
): Promise<void> {
  await db
    .update(messages)
    .set({ deliveryStatus: status })
    .where(eq(messages.providerMessageId, providerMessageId));
}

export async function getConversationHistory(
  conversationId: number,
  limit = 20,
): Promise<Message[]> {
  return db.query.messages.findMany({
    where: eq(messages.conversationId, conversationId),
    orderBy: (m, { desc }) => [desc(m.createdAt)],
    limit,
  });
}

/**
 * Marca un mensaje como atendido manualmente desde el dashboard (sección
 * "Pendientes de revisión"). Solo tiene efecto sobre mensajes que de verdad
 * necesitaban revisión (`needsHumanReview` o `isPurchaseIntent`) — así un id
 * cualquiera en el POST del form no puede "resolver" un mensaje que nunca estuvo
 * pendiente.
 */
export async function markMessageAsReviewed(messageId: number): Promise<void> {
  await db
    .update(messages)
    .set({ reviewedAt: new Date() })
    .where(
      and(
        eq(messages.id, messageId),
        or(eq(messages.needsHumanReview, true), eq(messages.isPurchaseIntent, true)),
      ),
    );
}

/**
 * Contraparte de {@link markMessageAsReviewed}: vuelve a poner el mensaje como
 * pendiente (`reviewedAt = null`), para el botón "Reabrir" de la lista de
 * resueltas recientes. Mismo criterio defensivo: solo afecta mensajes que de
 * verdad son de revisión.
 */
export async function reopenMessage(messageId: number): Promise<void> {
  await db
    .update(messages)
    .set({ reviewedAt: null })
    .where(
      and(
        eq(messages.id, messageId),
        or(eq(messages.needsHumanReview, true), eq(messages.isPurchaseIntent, true)),
      ),
    );
}
