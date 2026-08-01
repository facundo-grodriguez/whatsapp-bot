import type {
  CategoryCount,
  ConversationOutcomes,
  SessionCount,
} from "../db/repositories/stats.js";
import { formatDateParam } from "./dateRange.js";

/**
 * Escapa texto antes de interpolarlo en el HTML. Los nombres de sesión vienen de
 * WAHA y las etiquetas de categoría de configuración: no son entradas hostiles
 * hoy, pero escapar cuesta nada y evita que cualquier valor futuro pueda inyectar
 * markup.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function percentage(part: number, total: number): string {
  if (total === 0) return "0%";
  return `${((part / total) * 100).toFixed(1)}%`;
}

function formatDuration(ms: number | null): string {
  if (ms === null) return "sin datos";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export interface DashboardData {
  outcomes: ConversationOutcomes;
  byCategory: CategoryCount[];
  needsHumanReview: number;
  avgResponseTimeMs: number | null;
  bySession: SessionCount[];
  categoryLabels: Map<string, string>;
  filters: { from?: Date; to?: Date };
}

const STYLES = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 2rem 1.5rem;
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    line-height: 1.5; max-width: 60rem; margin-inline: auto;
  }
  h1 { font-size: 1.5rem; margin: 0 0 .25rem; }
  h2 { font-size: 1.05rem; margin: 2rem 0 .75rem; }
  .sub { color: #6b7280; font-size: .875rem; margin: 0 0 1.5rem; }
  form { display: flex; gap: .75rem; align-items: end; flex-wrap: wrap;
         padding: 1rem; border: 1px solid #d1d5db; border-radius: .5rem; margin-bottom: 1.5rem; }
  label { display: block; font-size: .8rem; color: #6b7280; margin-bottom: .25rem; }
  input, button { font: inherit; padding: .4rem .6rem; border-radius: .375rem;
                  border: 1px solid #d1d5db; background: transparent; color: inherit; }
  button { cursor: pointer; border-color: #2563eb; color: #2563eb; }
  a.reset { font-size: .875rem; color: #6b7280; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: .75rem; }
  .card { border: 1px solid #d1d5db; border-radius: .5rem; padding: .875rem 1rem; }
  .card .value { font-size: 1.75rem; font-weight: 600; line-height: 1.1; }
  .card .label { font-size: .8rem; color: #6b7280; margin-top: .25rem; }
  .card .pct { font-size: .8rem; color: #6b7280; }
  .card.ok { border-left: 3px solid #16a34a; }
  .card.warn { border-left: 3px solid #d97706; }
  .card.info { border-left: 3px solid #2563eb; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid #e5e7eb; }
  th { font-size: .8rem; text-transform: uppercase; letter-spacing: .03em; color: #6b7280; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  .empty { color: #6b7280; font-style: italic; padding: .75rem 0; }
  .note { color: #6b7280; font-size: .8rem; margin-top: .4rem; }
  @media (prefers-color-scheme: dark) {
    input, button, .card, form { border-color: #374151; }
    th, td { border-bottom-color: #1f2937; }
  }
`;

function renderFilters(filters: DashboardData["filters"]): string {
  return `
    <form method="get" action="/dashboard">
      <div>
        <label for="from">Desde</label>
        <input type="date" id="from" name="from" value="${escapeHtml(formatDateParam(filters.from))}">
      </div>
      <div>
        <label for="to">Hasta</label>
        <input type="date" id="to" name="to" value="${escapeHtml(formatDateParam(filters.to))}">
      </div>
      <button type="submit">Filtrar</button>
      <a class="reset" href="/dashboard">Ver todo</a>
    </form>`;
}

function renderOutcomes(outcomes: ConversationOutcomes, needsHumanReview: number): string {
  const { total, resueltasPorBot, derivadas, necesitaHumano } = outcomes;
  return `
    <div class="cards">
      <div class="card"><div class="value">${total}</div><div class="label">Conversaciones</div></div>
      <div class="card ok">
        <div class="value">${resueltasPorBot}</div>
        <div class="label">Resueltas por el bot</div>
        <div class="pct">${percentage(resueltasPorBot, total)}</div>
      </div>
      <div class="card info">
        <div class="value">${derivadas}</div>
        <div class="label">Derivadas a vendedor</div>
        <div class="pct">${percentage(derivadas, total)}</div>
      </div>
      <div class="card warn">
        <div class="value">${necesitaHumano}</div>
        <div class="label">Necesitan un humano</div>
        <div class="pct">${percentage(necesitaHumano, total)}</div>
      </div>
      <div class="card warn">
        <div class="value">${needsHumanReview}</div>
        <div class="label">Mensajes a revisar</div>
      </div>
    </div>
    <p class="note">
      "Resueltas por el bot" cuenta solo las conversaciones donde el bot dio una respuesta real.
      Las que únicamente recibieron el mensaje genérico caen en "necesitan un humano".
    </p>`;
}

function renderCategories(rows: CategoryCount[], labels: Map<string, string>): string {
  if (rows.length === 0) {
    return `<p class="empty">Todavía no hay respuestas registradas en este período.</p>`;
  }

  const total = rows.reduce((sum, row) => sum + row.count, 0);
  const body = rows
    .map(
      (row) => `
      <tr>
        <td>${escapeHtml(labels.get(row.category) ?? row.category)}</td>
        <td class="num">${row.count}</td>
        <td class="num">${percentage(row.count, total)}</td>
      </tr>`,
    )
    .join("");

  return `
    <table>
      <thead><tr><th>Categoría</th><th class="num">Respuestas</th><th class="num">%</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

function renderSessions(rows: SessionCount[]): string {
  if (rows.length === 0) {
    return `<p class="empty">Todavía no hay sesiones con actividad.</p>`;
  }

  const body = rows
    .map(
      (row) => `
      <tr>
        <td>${escapeHtml(row.sessionName)}</td>
        <td class="num">${row.conversations}</td>
        <td class="num">${row.messages}</td>
      </tr>`,
    )
    .join("");

  return `
    <table>
      <thead><tr><th>Sesión</th><th class="num">Conversaciones</th><th class="num">Mensajes</th></tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

/** Arma la página completa del dashboard. Sin JS de cliente: los datos ya vienen embebidos. */
export function renderDashboard(data: DashboardData): string {
  const periodo =
    data.filters.from || data.filters.to
      ? `${formatDateParam(data.filters.from) || "inicio"} → ${formatDateParam(data.filters.to) || "hoy"}`
      : "todo el historial";

  return `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Dashboard · Asistente de WhatsApp</title>
  <style>${STYLES}</style>
</head>
<body>
  <h1>Asistente de WhatsApp</h1>
  <p class="sub">Período: ${escapeHtml(periodo)}</p>

  ${renderFilters(data.filters)}
  ${renderOutcomes(data.outcomes, data.needsHumanReview)}

  <h2>Respuestas por categoría</h2>
  ${renderCategories(data.byCategory, data.categoryLabels)}

  <h2>Tiempo de respuesta</h2>
  <div class="cards">
    <div class="card">
      <div class="value">${formatDuration(data.avgResponseTimeMs)}</div>
      <div class="label">Promedio al cliente</div>
    </div>
  </div>
  <p class="note">
    Incluye el delay aleatorio configurado antes de responder (anti-ban), así que refleja la espera
    real del cliente, no la velocidad de procesamiento interna.
  </p>

  <h2>Volumen por sesión</h2>
  ${renderSessions(data.bySession)}
</body>
</html>`;
}
