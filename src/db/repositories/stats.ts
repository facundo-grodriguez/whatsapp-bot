import { and, eq, exists, gte, lte, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { db } from "../client.js";
import { conversations, messages } from "../schema.js";

/**
 * Filtros comunes a todas las agregaciones del dashboard. Todos opcionales:
 * sin filtros, cada función devuelve las métricas sobre todo el historial.
 */
export interface StatsFilters {
  from?: Date;
  to?: Date;
  sessionName?: string;
}

/** Condiciones de rango de fecha sobre una columna `created_at` cualquiera. */
function dateRangeConditions(column: typeof messages.createdAt, filters: StatsFilters) {
  return [
    filters.from ? gte(column, filters.from) : undefined,
    filters.to ? lte(column, filters.to) : undefined,
  ];
}

export interface CategoryCount {
  category: string;
  count: number;
}

/**
 * Cantidad de respuestas del bot agrupadas por categoría.
 *
 * Filtra `direction = 'outbound'` a propósito: `category` solo se persiste en los
 * mensajes salientes (`insertInboundMessageIfNew` no la setea), así que sin este
 * filtro la mitad de las filas caería en "sin categoría" y los porcentajes que se
 * muestran en el dashboard no significarían nada.
 */
export async function getResponseCountByCategory(
  filters: StatsFilters = {},
): Promise<CategoryCount[]> {
  const rows = await db
    .select({
      category: messages.category,
      count: sql<number>`count(*)`,
    })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(
      and(
        eq(messages.direction, "outbound"),
        filters.sessionName ? eq(conversations.sessionName, filters.sessionName) : undefined,
        ...dateRangeConditions(messages.createdAt, filters),
      ),
    )
    .groupBy(messages.category)
    .orderBy(sql`count(*) desc`);

  return rows.map((row) => ({
    category: row.category ?? "sin_categoria",
    count: Number(row.count),
  }));
}

export interface ConversationOutcomes {
  total: number;
  derivadas: number;
  resueltasPorBot: number;
  necesitaHumano: number;
}

/**
 * Clasifica cada conversación en exactamente uno de tres resultados posibles.
 *
 * La distinción entre `resueltasPorBot` y `necesitaHumano` es la parte importante:
 * una conversación donde el bot solo contestó el mensaje genérico de fallback NO
 * está resuelta — quedó esperando que la mire una persona. Contarla como resuelta
 * infla el número que se le muestra al cliente. `needs_human_review` existe en el
 * schema desde la Fase 1 exactamente para poder separarlas.
 */
export async function getConversationOutcomes(
  filters: StatsFilters = {},
): Promise<ConversationOutcomes> {
  const conversationFilter = and(
    filters.sessionName ? eq(conversations.sessionName, filters.sessionName) : undefined,
    filters.from ? gte(conversations.createdAt, filters.from) : undefined,
    filters.to ? lte(conversations.createdAt, filters.to) : undefined,
  );

  // Subconsulta correlacionada: ¿esta conversación tuvo al menos una respuesta
  // "real" del bot (una FAQ que matcheó), no solo un fallback?
  const hasRealAnswer = exists(
    db
      .select({ one: sql`1` })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversations.id),
          eq(messages.direction, "outbound"),
          eq(messages.needsHumanReview, false),
        ),
      ),
  );

  const [row] = await db
    .select({
      total: sql<number>`count(*)`,
      derivadas: sql<number>`sum(case when ${conversations.state} = 'derivada' then 1 else 0 end)`,
      resueltasPorBot: sql<number>`sum(case when ${conversations.state} != 'derivada' and ${hasRealAnswer} then 1 else 0 end)`,
      necesitaHumano: sql<number>`sum(case when ${conversations.state} != 'derivada' and not ${hasRealAnswer} then 1 else 0 end)`,
    })
    .from(conversations)
    .where(conversationFilter);

  return {
    total: Number(row?.total ?? 0),
    derivadas: Number(row?.derivadas ?? 0),
    resueltasPorBot: Number(row?.resueltasPorBot ?? 0),
    necesitaHumano: Number(row?.necesitaHumano ?? 0),
  };
}

/**
 * Tiempo promedio (ms) entre que entra un mensaje y sale su respuesta.
 *
 * OJO al interpretarlo: este número está dominado por el delay aleatorio
 * anti-ban de 1-3s (RESPONSE_DELAY_MIN_MS/MAX_MS), no por el tiempo de
 * procesamiento. Es válido como latencia percibida por el cliente, pero no como
 * medida de rendimiento interno del bot.
 *
 * Devuelve `null` si todavía no hay ninguna respuesta con `in_reply_to_id`.
 */
export async function getAvgResponseTimeMs(filters: StatsFilters = {}): Promise<number | null> {
  const inbound = alias(messages, "inbound");

  const [row] = await db
    .select({
      avgMs: sql<number | null>`avg(${messages.createdAt} - ${inbound.createdAt})`,
    })
    .from(messages)
    .innerJoin(inbound, eq(inbound.id, messages.inReplyToId))
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(
      and(
        eq(messages.direction, "outbound"),
        filters.sessionName ? eq(conversations.sessionName, filters.sessionName) : undefined,
        ...dateRangeConditions(messages.createdAt, filters),
      ),
    );

  const avgMs = row?.avgMs;
  return avgMs === null || avgMs === undefined ? null : Number(avgMs);
}

/**
 * Cantidad de mensajes marcados para revisión humana. Es la métrica más
 * accionable del set: dice cuántas consultas están esperando que alguien las mire.
 */
export async function getNeedsHumanReviewCount(filters: StatsFilters = {}): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(
      and(
        eq(messages.needsHumanReview, true),
        filters.sessionName ? eq(conversations.sessionName, filters.sessionName) : undefined,
        ...dateRangeConditions(messages.createdAt, filters),
      ),
    );

  return Number(row?.count ?? 0);
}

export interface SessionCount {
  sessionName: string;
  conversations: number;
  messages: number;
}

/** Volumen por sesión de WhatsApp (útil recién cuando hay más de un número). */
export async function getVolumeBySession(filters: StatsFilters = {}): Promise<SessionCount[]> {
  const rows = await db
    .select({
      sessionName: conversations.sessionName,
      conversations: sql<number>`count(distinct ${conversations.id})`,
      messages: sql<number>`count(${messages.id})`,
    })
    .from(conversations)
    .leftJoin(
      messages,
      and(
        eq(messages.conversationId, conversations.id),
        ...dateRangeConditions(messages.createdAt, filters),
      ),
    )
    .where(filters.sessionName ? eq(conversations.sessionName, filters.sessionName) : undefined)
    .groupBy(conversations.sessionName)
    .orderBy(sql`count(${messages.id}) desc`);

  return rows.map((row) => ({
    sessionName: row.sessionName,
    conversations: Number(row.conversations),
    messages: Number(row.messages),
  }));
}
