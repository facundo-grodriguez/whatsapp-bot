import { and, desc, eq, exists, gte, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/sqlite-core";

import { db } from "../client.js";
import { type ConversationState, conversations, messages } from "../schema.js";

/**
 * Filtros comunes a todas las agregaciones del dashboard. Todos opcionales:
 * sin filtros, cada función devuelve las métricas sobre todo el historial.
 */
export interface StatsFilters {
  from?: Date;
  to?: Date;
  channelId?: string;
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
        filters.channelId ? eq(conversations.channelId, filters.channelId) : undefined,
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
  sinResolverPorBot: number;
}

/**
 * Clasifica cada conversación en exactamente uno de tres resultados posibles.
 *
 * La distinción entre `resueltasPorBot` y `sinResolverPorBot` es la parte importante:
 * una conversación donde el bot solo contestó el mensaje genérico de fallback NO
 * está resuelta — quedó esperando que la mire una persona. Contarla como resuelta
 * infla el número que se le muestra al cliente. `needs_human_review` existe en el
 * schema desde la Fase 1 exactamente para poder separarlas. (Se llamaba
 * `necesitaHumano`; se renombró porque el nombre chocaba visualmente con
 * "Pendientes por responder" del dashboard, dando la falsa impresión de que debían
 * sumar lo mismo — ver nota en `renderDetailOutcomes`.)
 *
 * Excluye conversaciones sin ningún mensaje (`hasAnyMessage`): pueden existir si
 * `findOrCreateConversation` corrió pero la inserción del mensaje que le seguía
 * falló o se interrumpió después — sin esto, esas conversaciones "fantasma"
 * inflaban `total` y `sinResolverPorBot` sin que hubiera nada real que revisar
 * (se detectaron 4 en la base de desarrollo, todas artefactos de pruebas manuales
 * con timestamps inválidos, no tráfico real).
 */
export async function getConversationOutcomes(
  filters: StatsFilters = {},
): Promise<ConversationOutcomes> {
  const hasAnyMessage = exists(
    db.select({ one: sql`1` }).from(messages).where(eq(messages.conversationId, conversations.id)),
  );

  const conversationFilter = and(
    hasAnyMessage,
    filters.channelId ? eq(conversations.channelId, filters.channelId) : undefined,
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
      sinResolverPorBot: sql<number>`sum(case when ${conversations.state} != 'derivada' and not ${hasRealAnswer} then 1 else 0 end)`,
    })
    .from(conversations)
    .where(conversationFilter);

  return {
    total: Number(row?.total ?? 0),
    derivadas: Number(row?.derivadas ?? 0),
    resueltasPorBot: Number(row?.resueltasPorBot ?? 0),
    sinResolverPorBot: Number(row?.sinResolverPorBot ?? 0),
  };
}

/**
 * Tiempo promedio (ms) entre que entra un mensaje y sale su respuesta.
 *
 * OJO al interpretarlo: incluye el delay configurable antes de responder
 * (RESPONSE_DELAY_MIN_MS/MAX_MS, default 0, ver CLAUDE.md §2), no solo el
 * tiempo de procesamiento. Es válido como latencia percibida por el cliente,
 * pero no como medida de rendimiento interno del bot.
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
        filters.channelId ? eq(conversations.channelId, filters.channelId) : undefined,
        ...dateRangeConditions(messages.createdAt, filters),
      ),
    );

  const avgMs = row?.avgMs;
  return avgMs === null || avgMs === undefined ? null : Number(avgMs);
}

/**
 * Un mensaje "necesita revisión" por dos motivos posibles, distinguibles por
 * `category` en la fila:
 * - `needsHumanReview`: el bot no supo responder (fallback genérico).
 * - `isPurchaseIntent`: el bot sí respondió (avisó que deriva a ventas), pero
 *   igual queda un lead esperando seguimiento humano — hoy `notifyVendor()` es
 *   un stub que solo loguea, así que sin esto esos leads eran invisibles.
 */
function needsReviewCondition() {
  return or(eq(messages.needsHumanReview, true), eq(messages.isPurchaseIntent, true));
}

export interface PendingReviewItem {
  /** Id del mensaje saliente (el que tiene needsHumanReview/isPurchaseIntent), no
   *  del mensaje del cliente. Es lo que identifica la fila al marcarla como atendida. */
  id: number;
  /** Momento en que llegó el mensaje del cliente (no el de la respuesta del bot). */
  createdAt: Date;
  channelId: string;
  chatId: string;
  category: string;
  /** Texto del mensaje del cliente que quedó sin resolver — el contexto para retomarlo. */
  clientMessage: string;
  /** Id de la conversación — lo que necesita el botón "Reactivar bot". */
  conversationId: number;
  /** Si es "derivada", el dashboard muestra el botón "Reactivar bot" en esta fila. */
  conversationState: ConversationState;
  /** Nombre de perfil de WhatsApp del contacto, si Meta lo mandó alguna vez. `null` = mostrar el número. */
  senderName: string | null;
  /** Último acuse de estado de la respuesta del bot (sent/delivered/read/failed). `null` = todavía sin acuse. */
  deliveryStatus: string | null;
}

/**
 * Mensajes puntuales que necesitan que alguien haga algo, con el contexto para
 * retomarlos (no solo el número: el texto del cliente, el canal y un link al chat).
 * Sin esto, la única forma de encontrarlos era ir chat por chat en WhatsApp. La card
 * "Mensajes a revisar" del dashboard usa `.length` de este mismo resultado, para que
 * nunca pueda desincronizarse del número de filas que se ven en la tabla.
 *
 * Excluye los que ya se marcaron como atendidos (`reviewedAt` no nulo) — ver
 * `markMessageAsReviewed` en `db/repositories/messages.ts` y `getResolvedReviewCount`
 * más abajo, su contraparte.
 *
 * Ordenado del más viejo al más nuevo (cola FIFO): lo que lleva más tiempo
 * esperando aparece primero, para que nada quede olvidado.
 */
export async function getPendingReviewMessages(
  filters: StatsFilters = {},
): Promise<PendingReviewItem[]> {
  const inbound = alias(messages, "inbound");

  const rows = await db
    .select({
      id: messages.id,
      createdAt: inbound.createdAt,
      channelId: conversations.channelId,
      chatId: conversations.chatId,
      category: messages.category,
      clientMessage: inbound.body,
      conversationId: conversations.id,
      conversationState: conversations.state,
      senderName: conversations.senderName,
      deliveryStatus: messages.deliveryStatus,
    })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .innerJoin(inbound, eq(inbound.id, messages.inReplyToId))
    .where(
      and(
        needsReviewCondition(),
        isNull(messages.reviewedAt),
        filters.channelId ? eq(conversations.channelId, filters.channelId) : undefined,
        ...dateRangeConditions(messages.createdAt, filters),
      ),
    )
    .orderBy(inbound.createdAt)
    .limit(200);

  return rows.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    channelId: row.channelId,
    chatId: row.chatId,
    category: row.category ?? "sin_categoria",
    clientMessage: row.clientMessage,
    conversationId: row.conversationId,
    conversationState: row.conversationState,
    senderName: row.senderName,
    deliveryStatus: row.deliveryStatus,
  }));
}

/**
 * Cuántos mensajes se marcaron como atendidos manualmente desde el dashboard
 * (`reviewedAt` no nulo), dentro del mismo universo que `getPendingReviewMessages`
 * (mismo filtro de fecha/canal). Es el contador "Resueltas" que se muestra al lado
 * de "Mensajes a revisar", para tener una noción de cuánto se está resolviendo, no
 * solo cuánto queda pendiente.
 */
export async function getResolvedReviewCount(filters: StatsFilters = {}): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(
      and(
        needsReviewCondition(),
        isNotNull(messages.reviewedAt),
        filters.channelId ? eq(conversations.channelId, filters.channelId) : undefined,
        ...dateRangeConditions(messages.createdAt, filters),
      ),
    );

  return Number(row?.count ?? 0);
}

export interface ResolvedReviewItem {
  id: number;
  /** Cuándo se marcó como atendido (`reviewedAt`), no cuándo llegó el mensaje. */
  reviewedAt: Date;
  channelId: string;
  chatId: string;
  category: string;
  clientMessage: string;
  senderName: string | null;
  deliveryStatus: string | null;
}

const RECENTLY_RESOLVED_LIMIT = 20;

/**
 * Últimas resoluciones manuales, para el botón "Reabrir" (contraparte de
 * `markMessageAsReviewed`/`getPendingReviewMessages`). Sin esto no había forma de
 * deshacer un click apurado: la fila desaparecía de "Pendientes de revisión" para
 * siempre. Limitado a las últimas 20 a propósito — es para corregir un error
 * reciente, no un historial completo; para eso ya está "Resueltas manualmente"
 * (el conteo) y, más abajo, "Resultados" en Detalle. Siempre las más nuevas
 * primero (orden inverso al de `getPendingReviewMessages`): lo más probable que
 * alguien quiera reabrir es lo que acaba de marcar, no algo de hace días.
 */
export async function getRecentlyResolvedMessages(): Promise<ResolvedReviewItem[]> {
  const inbound = alias(messages, "inbound");

  const rows = await db
    .select({
      id: messages.id,
      reviewedAt: messages.reviewedAt,
      channelId: conversations.channelId,
      chatId: conversations.chatId,
      category: messages.category,
      clientMessage: inbound.body,
      senderName: conversations.senderName,
      deliveryStatus: messages.deliveryStatus,
    })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .innerJoin(inbound, eq(inbound.id, messages.inReplyToId))
    .where(and(needsReviewCondition(), isNotNull(messages.reviewedAt)))
    .orderBy(desc(messages.reviewedAt))
    .limit(RECENTLY_RESOLVED_LIMIT);

  return rows.map((row) => ({
    id: row.id,
    // isNotNull(messages.reviewedAt) en el where garantiza que nunca es null acá.
    reviewedAt: row.reviewedAt as Date,
    channelId: row.channelId,
    chatId: row.chatId,
    category: row.category ?? "sin_categoria",
    clientMessage: row.clientMessage,
    senderName: row.senderName,
    deliveryStatus: row.deliveryStatus,
  }));
}

/**
 * Cuántos `channelId` distintos tuvieron alguna conversación, sin filtro de
 * fecha ni de canal. Se usa para decidir si vale la pena mostrar "Volumen por
 * canal" en el dashboard — con un solo número de WhatsApp Business esa
 * comparación no aporta nada, solo ruido (ver renderDashboard). A propósito
 * sin filtro de fecha: si el negocio alguna vez usó 2+ canales, la sección debe
 * seguir apareciendo aunque el rango filtrado de hoy solo tenga uno.
 */
export async function getActiveChannelCount(): Promise<number> {
  const [row] = await db
    .select({ count: sql<number>`count(distinct ${conversations.channelId})` })
    .from(conversations);

  return Number(row?.count ?? 0);
}

export interface ChannelCount {
  channelId: string;
  conversations: number;
  messages: number;
}

/** Volumen por canal de WhatsApp (útil recién cuando hay más de un número de negocio). */
export async function getVolumeByChannel(filters: StatsFilters = {}): Promise<ChannelCount[]> {
  const rows = await db
    .select({
      channelId: conversations.channelId,
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
    .where(filters.channelId ? eq(conversations.channelId, filters.channelId) : undefined)
    .groupBy(conversations.channelId)
    .orderBy(sql`count(${messages.id}) desc`);

  return rows.map((row) => ({
    channelId: row.channelId,
    conversations: Number(row.conversations),
    messages: Number(row.messages),
  }));
}
