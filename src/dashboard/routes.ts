import type { FastifyInstance } from "fastify";

import { CATEGORIES } from "../config/categories.js";
import { resolveConversation } from "../db/repositories/conversations.js";
import { markMessageAsReviewed, reopenMessage } from "../db/repositories/messages.js";
import {
  getActiveChannelCount,
  getAvgResponseTimeMs,
  getConversationOutcomes,
  getPendingReviewMessages,
  getRecentlyResolvedMessages,
  getResolvedReviewCount,
  getResponseCountByCategory,
  getVolumeByChannel,
  type StatsFilters,
} from "../db/repositories/stats.js";
import { requireDashboardAuth } from "./auth.js";
import { parseDateParam } from "./dateRange.js";
import { renderDashboard } from "./render.js";

const categoryLabels = new Map(CATEGORIES.map((c) => [c.slug, c.label]));

/** Redirect 303 (POST -> GET) de vuelta al dashboard, preservando el filtro de fecha activo. */
function redirectToDashboard(body: { from?: string; to?: string }): { url: string; code: 303 } {
  const query = new URLSearchParams();
  if (body.from) query.set("from", body.from);
  if (body.to) query.set("to", body.to);
  const queryString = query.toString();
  return { url: `/dashboard${queryString ? `?${queryString}` : ""}`, code: 303 };
}

/**
 * Registra la vista del dashboard. Se llama solo si DASHBOARD_PASSWORD está
 * configurada (ver src/server.ts): si no lo está, la ruta no existe en vez de
 * quedar expuesta sin protección.
 *
 * La autenticación se aplica como preHandler de esta ruta puntual, nunca como
 * hook global, para no romper `/health` (monitoreo externo) ni `/webhook/whatsapp`.
 */
export async function registerDashboardRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Querystring: { from?: string; to?: string } }>(
    "/dashboard",
    { preHandler: requireDashboardAuth },
    async (request, reply) => {
      // El filtro de fecha vive dentro de la sección "Detalle" (ver render.ts): solo
      // afecta a Resultados/categorías/tiempo de respuesta/volumen por canal. El
      // resumen de arriba y la cola de "Pendientes de revisión" son siempre el
      // estado completo y actual, sin importar qué haya en `?from=`/`?to=` —
      // pedido explícito del usuario (2026-08-01): esa cola es justo lo que alguien
      // necesita ver íntegro para no perder de vista un pendiente por un filtro
      // que se le olvidó sacar.
      const detailFilters: StatsFilters = {
        from: parseDateParam(request.query.from),
        // El límite superior toma el día completo (23:59:59.999), si no un rango
        // "hasta hoy" excluiría todo lo de hoy.
        to: parseDateParam(request.query.to, true),
      };

      const [
        totalConversations,
        pendingReview,
        resolvedReviewCount,
        recentlyResolved,
        detailOutcomes,
        byCategory,
        avgResponseTimeMs,
        byChannel,
        activeChannelCount,
      ] = await Promise.all([
        getConversationOutcomes(),
        getPendingReviewMessages(),
        getResolvedReviewCount(),
        getRecentlyResolvedMessages(),
        getConversationOutcomes(detailFilters),
        getResponseCountByCategory(detailFilters),
        getAvgResponseTimeMs(detailFilters),
        getVolumeByChannel(detailFilters),
        getActiveChannelCount(),
      ]);

      const html = renderDashboard({
        total: totalConversations.total,
        outcomes: detailOutcomes,
        byCategory,
        // Misma fuente que la tabla de "Pendientes de revisión" de abajo: así el
        // número de la card nunca puede desincronizarse de las filas que muestra
        // (antes salía de una query separada que no contaba intención de compra).
        needsHumanReview: pendingReview.length,
        resolvedReviewCount,
        pendingReview,
        recentlyResolved,
        avgResponseTimeMs,
        byChannel,
        // Con 2+ canales activos alguna vez: muestra "Volumen por canal" Y el
        // canal inline en "Pendientes de revisión" (ver renderContact). Con uno
        // solo, ambas cosas son ruido — ver getActiveChannelCount. A propósito NO
        // se usa byChannel.length (ese está filtrado por fecha, ver
        // detailFilters): la decisión no debe depender del rango elegido.
        hasMultipleChannels: activeChannelCount >= 2,
        categoryLabels,
        filters: { from: detailFilters.from, to: detailFilters.to },
      });

      return reply.type("text/html; charset=utf-8").send(html);
    },
  );

  // El botón "Marcar como atendido" de cada fila pendiente es un <form method="post">
  // sin JS (ver renderPendingReview): se resuelve acá y se redirige de vuelta al
  // dashboard preservando el filtro de fecha que tenía puesto quien lo marcó.
  fastify.post<{ Params: { id: string }; Body: { from?: string; to?: string } }>(
    "/dashboard/pending/:id/resolve",
    { preHandler: requireDashboardAuth },
    async (request, reply) => {
      const messageId = Number(request.params.id);
      if (Number.isInteger(messageId)) {
        await markMessageAsReviewed(messageId);
      }

      const { url, code } = redirectToDashboard(request.body);
      return reply.redirect(url, code);
    },
  );

  // Contraparte del anterior: el botón "Reabrir" de la lista de "Resueltas
  // recientemente" (ver renderRecentlyResolved). Mismo patrón sin JS.
  fastify.post<{ Params: { id: string }; Body: { from?: string; to?: string } }>(
    "/dashboard/pending/:id/reopen",
    { preHandler: requireDashboardAuth },
    async (request, reply) => {
      const messageId = Number(request.params.id);
      if (Number.isInteger(messageId)) {
        await reopenMessage(messageId);
      }

      const { url, code } = redirectToDashboard(request.body);
      return reply.redirect(url, code);
    },
  );

  // Botón "Reactivar bot" de la lista de pendientes, visible solo en las filas
  // cuya conversación está derivada (ver renderPendingReview). Vuelve el bot a
  // responder ahí — no marca ningún mensaje como atendido, es un concepto
  // distinto (conversación vs. mensaje puntual). Mismo patrón sin JS.
  fastify.post<{ Params: { id: string }; Body: { from?: string; to?: string } }>(
    "/dashboard/conversations/:id/resolve",
    { preHandler: requireDashboardAuth },
    async (request, reply) => {
      const conversationId = Number(request.params.id);
      if (Number.isInteger(conversationId)) {
        await resolveConversation(conversationId);
      }

      const { url, code } = redirectToDashboard(request.body);
      return reply.redirect(url, code);
    },
  );
}
