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
 * Una conversación se identifica por (sessionName, chatId), no solo por chatId.
 * Esto es lo que permite que la Fase 2 (multi-sesión) no requiera migrar esta tabla:
 * varios números de WhatsApp pueden compartir la misma lógica sin chocar chatIds.
 */
export const conversations = sqliteTable(
  "conversations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sessionName: text("session_name").notNull(),
    chatId: text("chat_id").notNull(),
    state: text("state", { enum: CONVERSATION_STATES }).notNull().default("activa"),
    derivedAt: integer("derived_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .notNull()
      .$defaultFn(() => new Date()),
  },
  (table) => [
    unique("conversations_session_chat_unique").on(table.sessionName, table.chatId),
    // Base de las agregaciones "por sesión" y "derivadas vs resueltas" de la Fase 3.
    index("conversations_session_state_idx").on(table.sessionName, table.state),
  ],
);

export const MESSAGE_DIRECTIONS = ["inbound", "outbound"] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export const messages = sqliteTable(
  "messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    conversationId: integer("conversation_id")
      .notNull()
      .references(() => conversations.id),
    // WAHA reintenta el webhook si no responde 200 a tiempo. Esta columna es lo que
    // hace idempotente la inserción: un mismo mensaje nunca se guarda dos veces.
    wahaMessageId: text("waha_message_id").unique(),
    direction: text("direction", { enum: MESSAGE_DIRECTIONS }).notNull(),
    body: text("body").notNull(),
    category: text("category").references(() => categories.slug),
    isPurchaseIntent: integer("is_purchase_intent", { mode: "boolean" }).notNull().default(false),
    needsHumanReview: integer("needs_human_review", { mode: "boolean" }).notNull().default(false),
    // Referencia al mensaje inbound que esta respuesta contesta. Permite calcular
    // tiempo de respuesta del bot en la Fase 3 sin cambiar el esquema. La referencia
    // es a la propia tabla, por eso se declara como función lazy tipada.
    inReplyToId: integer("in_reply_to_id").references((): AnySQLiteColumn => messages.id),
    waTimestamp: integer("wa_timestamp", { mode: "timestamp_ms" }),
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
