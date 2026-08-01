import { and, eq } from "drizzle-orm";

import { db } from "../client.js";
import { type ConversationState, conversations } from "../schema.js";

export type Conversation = typeof conversations.$inferSelect;

/**
 * Devuelve la conversación existente para (sessionName, chatId) o la crea si es la
 * primera vez que ese chat escribe. Es el punto de entrada de todo mensaje inbound.
 */
export async function findOrCreateConversation(
  sessionName: string,
  chatId: string,
): Promise<Conversation> {
  const existing = await db.query.conversations.findFirst({
    where: and(eq(conversations.sessionName, sessionName), eq(conversations.chatId, chatId)),
  });

  if (existing) {
    return existing;
  }

  const [created] = await db
    .insert(conversations)
    .values({ sessionName, chatId })
    .onConflictDoNothing()
    .returning();

  // Carrera entre dos inserts concurrentes para el mismo chat: el que perdió el
  // onConflictDoNothing no tiene fila devuelta, así que se relee la existente.
  if (created) {
    return created;
  }

  const winner = await db.query.conversations.findFirst({
    where: and(eq(conversations.sessionName, sessionName), eq(conversations.chatId, chatId)),
  });

  if (!winner) {
    throw new Error(
      `No se pudo crear ni recuperar la conversación (${sessionName}, ${chatId})`,
    );
  }

  return winner;
}

/**
 * Relee la conversación por id. El orquestador la usa para obtener el estado
 * autoritativo al momento de procesar (no el que tenía cuando se encoló el
 * mensaje), ya que otro mensaje de la misma conversación pudo haberla derivado
 * mientras este esperaba en la cola.
 */
export async function getConversationById(id: number): Promise<Conversation | null> {
  const conversation = await db.query.conversations.findFirst({
    where: eq(conversations.id, id),
  });
  return conversation ?? null;
}

export async function setConversationState(
  conversationId: number,
  state: ConversationState,
): Promise<void> {
  await db
    .update(conversations)
    .set({
      state,
      derivedAt: state === "derivada" ? new Date() : null,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId));
}
