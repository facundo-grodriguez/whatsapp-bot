import { eq } from "drizzle-orm";

import { db } from "../client.js";
import { type MessageDirection, messages } from "../schema.js";

export type Message = typeof messages.$inferSelect;

export interface InsertInboundMessageInput {
  conversationId: number;
  wahaMessageId: string;
  body: string;
  waTimestamp: Date | null;
}

/**
 * Inserta un mensaje entrante de forma idempotente: si `wahaMessageId` ya existe
 * (reintento de webhook de WAHA), no duplica la fila y devuelve `null` para que el
 * llamador sepa que no debe volver a encolar el procesamiento.
 */
export async function insertInboundMessageIfNew(
  input: InsertInboundMessageInput,
): Promise<Message | null> {
  const [inserted] = await db
    .insert(messages)
    .values({
      conversationId: input.conversationId,
      wahaMessageId: input.wahaMessageId,
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
    })
    .returning();

  if (!inserted) {
    throw new Error("No se pudo insertar el mensaje saliente");
  }

  return inserted;
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
