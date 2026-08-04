import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core";
import { index, integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

/**
 * Categorías de mensajes. Existe desde la Fase 1 aunque todavía no haya dashboard:
 * la regla que matchea un mensaje ya sabe a qué categoría pertenece, y guardarla
 * desde el día uno evita tener que hacer un backfill cuando llegue la Fase 3.
 */
export const categories = sqliteTable("categories", {
  slug: text("slug").primaryKey(),
  label: text("label").notNull(),
});

export const CONVERSATION_STATES = ["activa", "derivada"] as const;
export type ConversationState = (typeof CONVERSATION_STATES)[number];

/**
 * Una conversación se identifica por (channelId, chatId), no solo por chatId.
 * `channelId` es "cuál de nuestros números" — del lado de la Cloud API de Meta,
 * el `phone_number_id` (ver src/messaging/). El nombre se mantiene neutro
 * (no `phoneNumberId`) por la misma razón que `src/engine/types.ts` no importa
 * de `db/` ni `messaging/`: nada fuera de `src/messaging/cloudApi/` necesita
 * saber que ese id es específicamente de Meta.
 *
 * Permite que un negocio con varios números de WhatsApp comparta la misma
 * lógica sin chocar chatIds (equivalente a lo que antes era multi-sesión de WAHA).
 */
export const conversations = sqliteTable(
  "conversations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    channelId: text("channel_id").notNull(),
    chatId: text("chat_id").notNull(),
    state: text("state", { enum: CONVERSATION_STATES }).notNull().default("activa"),
    derivedAt: integer("derived_at", { mode: "timestamp_ms" }),
    // Cuándo se reactivó el bot para esta conversación después de estar derivada
    // (dashboard, botón "Reactivar bot" — ver db/repositories/conversations.ts).
    // `null` = nunca se reactivó (o se volvió a derivar desde entonces: ver
    // setConversationState, que la limpia de nuevo al re-derivar). A propósito NO
    // se pisa `derivedAt`: esa columna es historial de cuándo se derivó, esta es
    // de cuándo se resolvió — pueden convivir.
    resolvedAt: integer("resolved_at", { mode: "timestamp_ms" }),
    // Nombre de perfil de WhatsApp del contacto (lo manda Meta en cada mensaje
    // entrante, no siempre). Se guarda en la conversación, no en cada mensaje,
    // porque es un dato del contacto, no del mensaje puntual — se refresca cada
    // vez que llega uno nuevo y distinto (ver findOrCreateConversation). `null`
    // si Meta nunca lo mandó: el dashboard cae al número en ese caso.
    senderName: text("sender_name"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    unique("conversations_channel_chat_unique").on(table.channelId, table.chatId),
    // Base de las agregaciones "por canal" y "derivadas vs resueltas" de la Fase 3.
    index("conversations_channel_state_idx").on(table.channelId, table.state),
  ],
);

export const MESSAGE_DIRECTIONS = ["inbound", "outbound"] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

// Espejo local de messaging/types.ts (DELIVERY_STATUSES): se redeclara acá en
// vez de importarla, mismo criterio que MESSAGE_DIRECTIONS/CONVERSATION_STATES
// — db/ no importa de messaging/ (ver regla de aislamiento en messaging/types.ts
// y CLAUDE.md §8).
export const MESSAGE_DELIVERY_STATUSES = ["sent", "delivered", "read", "failed"] as const;
export type MessageDeliveryStatus = (typeof MESSAGE_DELIVERY_STATUSES)[number];

export const messages = sqliteTable(
  "messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversations.id),
    // Meta reintenta el webhook si no responde 200 a tiempo. Esta columna es lo que
    // hace idempotente la inserción: un mismo mensaje nunca se guarda dos veces.
    // Guarda el `wamid.XXX` que manda la Cloud API (antes, el id de WAHA).
    providerMessageId: text("provider_message_id").unique(),
    direction: text("direction", { enum: MESSAGE_DIRECTIONS }).notNull(),
    body: text("body").notNull(),
    category: text("category").references(() => categories.slug),
    isPurchaseIntent: integer("is_purchase_intent", { mode: "boolean" }).notNull().default(false),
    needsHumanReview: integer("needs_human_review", { mode: "boolean" }).notNull().default(false),
    // Momento en que alguien marcó esta respuesta como atendida desde el dashboard
    // (Fase 3, sección "Pendientes de revisión"). `null` = todavía pendiente. Vive en
    // el mensaje saliente (el mismo que carga `needsHumanReview`/`isPurchaseIntent`),
    // no en la conversación, porque una conversación puede tener varios mensajes
    // pendientes en momentos distintos.
    reviewedAt: integer("reviewed_at", { mode: "timestamp_ms" }),
    // Referencia al mensaje inbound que esta respuesta contesta. Permite calcular
    // tiempo de respuesta del bot en la Fase 3 sin cambiar el esquema. La referencia
    // es a la propia tabla, por eso se declara como función lazy tipada.
    inReplyToId: integer("in_reply_to_id").references((): AnySQLiteColumn => messages.id),
    waTimestamp: integer("wa_timestamp", { mode: "timestamp_ms" }),
    // Último acuse de estado que mandó Meta para este mensaje SALIENTE (evento
    // `statuses` del webhook, ver webhook/routes.ts). `null` = todavía no llegó
    // ningún acuse (recién enviado, o dry-run, que nunca manda nada real). Solo
    // tiene sentido en mensajes outbound; nunca se setea en inbound.
    deliveryStatus: text("delivery_status", { enum: MESSAGE_DELIVERY_STATUSES }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    // Historial de una conversación (usado en cada request del webhook).
    index("messages_conversation_id_idx").on(table.conversationId),
    // Agregación "% de mensajes por categoría" de la Fase 3.
    index("messages_category_idx").on(table.category),
    // Agregación "por rango de fecha" de la Fase 3.
    index("messages_created_at_idx").on(table.createdAt),
  ],
);
