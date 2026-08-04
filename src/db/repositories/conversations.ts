import { and, eq } from "drizzle-orm";

import { db } from "../client.js";
import { type ConversationState, conversations } from "../schema.js";

export type Conversation = typeof conversations.$inferSelect;

/**
 * Devuelve la conversación existente para (channelId, chatId) o la crea si es la
 * primera vez que ese chat escribe. Es el punto de entrada de todo mensaje inbound.
 *
 * `senderName` (nombre de perfil de WhatsApp, si Meta lo mandó con este mensaje)
 * se persiste/refresca acá: si la conversación ya existe y llega un nombre nuevo
 * y distinto del guardado, se actualiza — así se sigue el nombre si el contacto
 * lo cambia, sin sumar una escritura extra cuando no cambió nada.
 */
export async function findOrCreateConversation(
  channelId: string,
  chatId: string,
  senderName?: string | null,
): Promise<Conversation> {
  const existing = await db.query.conversations.findFirst({
    where: and(eq(conversations.channelId, channelId), eq(conversations.chatId, chatId)),
  });

  if (existing) {
    if (senderName && senderName !== existing.senderName) {
      const [updated] = await db
        .update(conversations)
        .set({ senderName, updatedAt: new Date() })
        .where(eq(conversations.id, existing.id))
        .returning();
      return updated ?? existing;
    }
    return existing;
  }

  const [created] = await db
    .insert(conversations)
    .values({ channelId, chatId, senderName: senderName ?? null })
    .onConflictDoNothing()
    .returning();

  // Carrera entre dos inserts concurrentes para el mismo chat: el que perdió el
  // onConflictDoNothing no tiene fila devuelta, así que se relee la existente.
  if (created) {
    return created;
  }

  const winner = await db.query.conversations.findFirst({
    where: and(eq(conversations.channelId, channelId), eq(conversations.chatId, chatId)),
  });

  if (!winner) {
    throw new Error(
      `No se pudo crear ni recuperar la conversación (${channelId}, ${chatId})`,
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
      // Si se vuelve a derivar, deja de estar "resuelta" (ver botón "Reactivar
      // bot" del dashboard, resolveConversation más abajo).
      resolvedAt: null,
      updatedAt: new Date(),
    })
    .where(eq(conversations.id, conversationId));
}

/**
 * Reactiva el bot para una conversación derivada: vuelve `state` a "activa" y
 * registra `resolvedAt`. Botón "Reactivar bot" del dashboard — contraparte de
 * la derivación automática por intención de compra.
 *
 * A propósito NO pisa `derivedAt`: esa columna es historial de cuándo se derivó
 * (útil incluso después de reactivar), distinto de `resolvedAt` que es cuándo
 * se resolvió. Si el cliente vuelve a mostrar intención de compra después de
 * reactivado, `setConversationState` la deriva de nuevo sin problema — el lead
 * no se pierde, aunque pueda sorprender ver la conversación derivarse dos veces.
 *
 * Guardado defensivo: solo tiene efecto si la conversación está de verdad
 * derivada, mismo criterio que `markMessageAsReviewed` en messages.ts.
 */
export async function resolveConversation(conversationId: number): Promise<void> {
  await db
    .update(conversations)
    .set({ state: "activa", resolvedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(conversations.id, conversationId), eq(conversations.state, "derivada")));
}
