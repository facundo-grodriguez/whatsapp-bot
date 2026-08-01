import type { FastifyInstance } from "fastify";

import { CATEGORIES } from "../config/categories.js";
import {
  getAvgResponseTimeMs,
  getConversationOutcomes,
  getNeedsHumanReviewCount,
  getResponseCountByCategory,
  getVolumeBySession,
  type StatsFilters,
} from "../db/repositories/stats.js";
import { requireDashboardAuth } from "./auth.js";
import { parseDateParam } from "./dateRange.js";
import { renderDashboard } from "./render.js";

const categoryLabels = new Map(CATEGORIES.map((c) => [c.slug, c.label]));

/**
 * Registra la vista del dashboard. Se llama solo si DASHBOARD_PASSWORD está
 * configurada (ver src/server.ts): si no lo está, la ruta no existe en vez de
 * quedar expuesta sin protección.
 *
 * La autenticación se aplica como preHandler de esta ruta puntual, nunca como
 * hook global, para no romper `/health` (monitoreo externo) ni `/webhook/waha`.
 */
export async function registerDashboardRoutes(fastify: FastifyInstance): Promise<void> {
  fastify.get<{ Querystring: { from?: string; to?: string } }>(
    "/dashboard",
    { preHandler: requireDashboardAuth },
    async (request, reply) => {
      const filters: StatsFilters = {
        from: parseDateParam(request.query.from),
        // El límite superior toma el día completo (23:59:59.999), si no un rango
        // "hasta hoy" excluiría todo lo de hoy.
        to: parseDateParam(request.query.to, true),
      };

      const [outcomes, byCategory, needsHumanReview, avgResponseTimeMs, bySession] =
        await Promise.all([
          getConversationOutcomes(filters),
          getResponseCountByCategory(filters),
          getNeedsHumanReviewCount(filters),
          getAvgResponseTimeMs(filters),
          getVolumeBySession(filters),
        ]);

      const html = renderDashboard({
        outcomes,
        byCategory,
        needsHumanReview,
        avgResponseTimeMs,
        bySession,
        categoryLabels,
        filters: { from: filters.from, to: filters.to },
      });

      return reply.type("text/html; charset=utf-8").send(html);
    },
  );
}
