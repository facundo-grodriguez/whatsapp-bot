import type {
  CategoryCount,
  ConversationOutcomes,
  PendingReviewItem,
  ResolvedReviewItem,
  ChannelCount,
} from "../db/repositories/stats.js";
import { getChannelLabel } from "../config/channels.js";
import { formatDateParam } from "./dateRange.js";

/**
 * Escapa texto antes de interpolarlo en el HTML. Las etiquetas de canal
 * (`CHANNEL_LABELS`) y de categoría vienen de configuración propia: no son
 * entradas hostiles hoy, pero escapar cuesta nada y evita que cualquier valor
 * futuro pueda inyectar markup.
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

function formatDateTime(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${day}/${month} ${hours}:${minutes}`;
}

/** Hace cuánto llegó el mensaje del cliente, en la unidad más legible ("2 h", "3 d"). */
function formatAge(since: Date, now: Date): string {
  const minutes = Math.max(0, Math.round((now.getTime() - since.getTime()) / 60_000));
  if (minutes < 1) return "recién";
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.round(hours / 24);
  return `${days} d`;
}

/**
 * WhatsApp abre un chat directo a partir del número si se lo pasás en la URL de
 * wa.me. `chatId` es el `wa_id` que manda la Cloud API de Meta: solo dígitos,
 * sin sufijo.
 */
function chatIdToWaLink(chatId: string): string {
  return `https://wa.me/${encodeURIComponent(chatId)}`;
}

/**
 * Nombre de perfil de WhatsApp + número, siempre los dos juntos (el nombre solo
 * no alcanza para ubicar el chat, y el número crudo sin nombre es igual de
 * válido cuando no hay uno). `channelLabel` es opcional y ya viene resuelto por
 * el llamador (solo lo pasa si es una etiqueta linda configurada de verdad, ver
 * renderPendingReview) — acá no hay que decidir nada, solo sumarlo si vino.
 */
function renderContact(chatId: string, senderName: string | null, channelLabel: string | null): string {
  const base = senderName ? `${escapeHtml(senderName)} (${escapeHtml(chatId)})` : escapeHtml(chatId);
  return channelLabel ? `${base} · ${escapeHtml(channelLabel)}` : base;
}

const DELIVERY_STATUS_LABELS: Record<string, string> = {
  sent: "Enviado",
  delivered: "Entregado",
  read: "Leído",
  failed: "No entregado",
};

/**
 * Indicador simple de estado de entrega de la respuesta del bot, a partir de los
 * acuses `statuses` que ya llegan por el webhook (ver webhook/routes.ts,
 * updateDeliveryStatus). `null` cubre tanto "todavía no llegó ningún acuse" como
 * dry-run (nunca manda nada real, nunca hay acuse).
 */
function renderDeliveryStatus(status: string | null): string {
  if (status === null) return "—";
  return escapeHtml(DELIVERY_STATUS_LABELS[status] ?? status);
}

const DELIVERY_STATUS_DOTS: Record<string, { label: string; cssClass: string }> = {
  sent: { label: "Tu respuesta: enviada", cssClass: "delivery-dot delivery-sent" },
  delivered: { label: "Tu respuesta: entregada", cssClass: "delivery-dot delivery-delivered" },
  read: { label: "Tu respuesta: leída", cssClass: "delivery-dot delivery-read" },
  failed: { label: "Tu respuesta: no se pudo entregar", cssClass: "delivery-dot delivery-failed" },
};

/**
 * Punto de color con el estado de entrega de LA RESPUESTA DEL BOT (no del
 * mensaje del cliente — por eso va pegado a "Categoría", que es lo que
 * representa esa respuesta, no a "Mensaje del cliente"). El texto completo va
 * en el `title` (tooltip). `null` no muestra nada — dry-run o todavía sin acuse.
 */
function renderDeliveryIcon(status: string | null): string {
  if (status === null) return "";
  const entry = DELIVERY_STATUS_DOTS[status];
  if (!entry) return "";
  return ` <span class="${entry.cssClass}" title="${escapeHtml(entry.label)}"></span>`;
}

export interface DashboardData {
  /** Total de conversaciones de siempre, sin filtro de fecha (ver sección 3 del resumen). */
  total: number;
  /** Desglose (resueltas/derivadas/sin resolver) YA filtrado por fecha — es "Detalle". */
  outcomes: ConversationOutcomes;
  byCategory: CategoryCount[];
  needsHumanReview: number;
  resolvedReviewCount: number;
  pendingReview: PendingReviewItem[];
  recentlyResolved: ResolvedReviewItem[];
  avgResponseTimeMs: number | null;
  byChannel: ChannelCount[];
  /**
   * Solo tiene sentido comparar/mostrar canales cuando hay 2+ activos alguna vez
   * (ver getActiveChannelCount). Doble uso: oculta la sección "Volumen por
   * canal" completa, y en "Pendientes de revisión" decide si el canal se
   * muestra inline junto al contacto o se omite del todo (con un solo canal,
   * repetirlo en cada fila es puro ruido).
   */
  hasMultipleChannels: boolean;
  categoryLabels: Map<string, string>;
  /** Solo se usa para prellenar el form de filtros y el período mostrado dentro de "Detalle". */
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
  .filters-form { display: flex; gap: .75rem; align-items: end; flex-wrap: wrap;
         padding: 1rem; border: 1px solid #d1d5db; border-radius: .5rem; margin-bottom: 1.5rem; }
  label { display: block; font-size: .8rem; color: #6b7280; margin-bottom: .25rem; }
  input, button { font: inherit; padding: .4rem .6rem; border-radius: .375rem;
                  border: 1px solid #d1d5db; background: transparent; color: inherit; }
  button { cursor: pointer; border-color: #2563eb; color: #2563eb; }
  a.reset { font-size: .875rem; color: #6b7280; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: .75rem; }
  .cards + .cards { margin-top: .75rem; }
  .card { border: 1px solid #d1d5db; border-radius: .5rem; padding: .875rem 1rem; }
  .card .value { font-size: 1.75rem; font-weight: 600; line-height: 1.1; }
  .card .label { font-size: .8rem; color: #6b7280; margin-top: .25rem; }
  .card .pct { font-size: .8rem; color: #6b7280; }
  .card.ok { border-left: 3px solid #16a34a; }
  .card.warn { border-left: 3px solid #d97706; }
  .card.info { border-left: 3px solid #2563eb; }
  .section-divider { border: none; border-top: 1px solid #d1d5db; margin: 2.5rem 0 0; }
  .section-label { margin: 1.5rem 0 0; }
  table { border-collapse: collapse; width: 100%; }
  th, td { text-align: left; padding: .5rem .6rem; border-bottom: 1px solid #e5e7eb; }
  th { font-size: .8rem; text-transform: uppercase; letter-spacing: .03em; color: #6b7280; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  /* display: block (no inline) para que, cuando una celda tiene dos forms
     (ej. "Reactivar bot" + "Marcar como atendido"), queden apilados prolijos
     con el mismo borde izquierdo en vez de desalinearse según el ancho del
     botón anterior. */
  td form { display: block; margin: 0 0 .35rem; }
  td form:last-child { margin-bottom: 0; }
  td form button { padding: .3rem .5rem; font-size: .8rem; }
  .empty { color: #6b7280; font-style: italic; padding: .75rem 0; }
  [title] { cursor: help; }
  .delivery-dot { display: inline-block; width: .5rem; height: .5rem; border-radius: 50%; margin-left: .4rem; vertical-align: middle; }
  .delivery-sent, .delivery-delivered { background: #9ca3af; }
  .delivery-read { background: #2563eb; }
  .delivery-failed { background: #d97706; }
  details { margin-top: 1rem; }
  summary { cursor: pointer; font-size: .875rem; color: #6b7280; }
  details table { margin-top: .75rem; }
  .note { color: #6b7280; font-size: .8rem; margin-top: .4rem; }
  @media (prefers-color-scheme: dark) {
    input, button, .card, .filters-form { border-color: #374151; }
    th, td { border-bottom-color: #1f2937; }
    .section-divider { border-top-color: #374151; }
  }
`;

function renderFilters(filters: DashboardData["filters"]): string {
  return `
    <form class="filters-form" method="get" action="/dashboard">
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

/**
 * Resumen "de un vistazo": lo que necesita quien está laburando la bandeja de
 * pendientes, no un análisis. Va arriba de todo, antes de la tabla de pendientes.
 */
function renderPrimarySummary(
  total: number,
  needsHumanReview: number,
  resolvedReviewCount: number,
): string {
  return `
    <div class="cards">
      <div class="card"><div class="value">${total}</div><div class="label">Conversaciones</div></div>
      <div class="card warn">
        <div class="value">${needsHumanReview}</div>
        <div class="label">Pendientes por responder</div>
      </div>
      <div class="card ok">
        <div class="value">${resolvedReviewCount}</div>
        <div class="label">Resueltas manualmente</div>
      </div>
    </div>`;
}

/**
 * Desglose analítico: cómo se resolvió cada cosa, no qué queda por hacer. Pensado
 * para el dueño del negocio mirando cómo viene funcionando el bot, no para el día
 * a día de responder — por eso va después de la tabla de pendientes, no antes.
 */
function renderDetailOutcomes(outcomes: ConversationOutcomes): string {
  const { total, resueltasPorBot, derivadas, sinResolverPorBot } = outcomes;
  return `
    <div class="cards">
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
        <div class="value">${sinResolverPorBot}</div>
        <div class="label">Sin resolver por el bot</div>
        <div class="pct">${percentage(sinResolverPorBot, total)}</div>
      </div>
    </div>
    <p class="note">
      "Resueltas por el bot" cuenta solo las conversaciones donde el bot dio una respuesta real.
      Las que únicamente recibieron el mensaje genérico caen en "sin resolver por el bot" — son
      conversaciones, no mensajes: si una misma conversación tuvo más de un mensaje pendiente (ej.
      una consulta sin responder y después una derivación), cuenta una sola vez acá pero varias en
      "Pendientes por responder" de arriba, que sí cuenta mensaje por mensaje. Por eso los totales
      no tienen por qué coincidir exactamente.
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

function renderPendingReview(
  rows: PendingReviewItem[],
  labels: Map<string, string>,
  filters: { from?: Date; to?: Date },
  hasMultipleChannels: boolean,
): string {
  if (rows.length === 0) {
    return `<p class="empty">No hay mensajes pendientes de revisión en este período. 🎉</p>`;
  }

  const now = new Date();
  // Se reenvían como hidden fields para que, al marcar una fila como atendida, el
  // POST redirija de vuelta al mismo rango de fechas que tenía puesto quien lo hizo
  // (si no, el filtro se perdería y volvería a "todo el historial").
  const fromValue = escapeHtml(formatDateParam(filters.from));
  const toValue = escapeHtml(formatDateParam(filters.to));

  const body = rows
    .map((row) => {
      // getChannelLabel cae al channelId crudo si no hay entrada en CHANNEL_LABELS
      // (ver config/channels.ts) — en ese caso no vale la pena mostrarlo, es
      // ruido (un phone_number_id larguísimo sin significado a simple vista).
      const resolvedLabel = getChannelLabel(row.channelId);
      const channelLabel =
        hasMultipleChannels && resolvedLabel !== row.channelId ? resolvedLabel : null;
      const reactivarBotForm =
        row.conversationState === "derivada"
          ? `<form method="post" action="/dashboard/conversations/${row.conversationId}/resolve">
               <input type="hidden" name="from" value="${fromValue}">
               <input type="hidden" name="to" value="${toValue}">
               <button type="submit">Reactivar bot</button>
             </form>`
          : "";

      return `
      <tr>
        <td title="${escapeHtml(formatDateTime(row.createdAt))}">${formatAge(row.createdAt, now)}</td>
        <td>${renderContact(row.chatId, row.senderName, channelLabel)}</td>
        <td>${escapeHtml(row.clientMessage)}</td>
        <td>${escapeHtml(labels.get(row.category) ?? row.category)}${renderDeliveryIcon(row.deliveryStatus)}</td>
        <td><a href="${chatIdToWaLink(row.chatId)}" target="_blank" rel="noopener">Abrir chat</a></td>
        <td>
          ${reactivarBotForm}
          <form method="post" action="/dashboard/pending/${row.id}/resolve">
            <input type="hidden" name="from" value="${fromValue}">
            <input type="hidden" name="to" value="${toValue}">
            <button type="submit">Marcar como atendido</button>
          </form>
        </td>
      </tr>`;
    })
    .join("");

  return `
    <table>
      <thead><tr>
        <th>Antigüedad</th><th>Contacto</th><th>Mensaje del cliente</th>
        <th>Categoría</th><th>Chat</th><th>Atendido</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>
    <p class="note">
      Ordenado del más viejo al más nuevo. "Reactivar bot" solo aparece en conversaciones derivadas.
      "Marcar como atendido" se puede deshacer desde "Resueltas recientemente" más abajo.
    </p>`;
}

function renderRecentlyResolved(rows: ResolvedReviewItem[]): string {
  if (rows.length === 0) {
    return `<p class="empty">Todavía no se marcó nada como atendido.</p>`;
  }

  const body = rows
    .map(
      (row) => `
      <tr>
        <td>${formatDateTime(row.reviewedAt)}</td>
        <td>${escapeHtml(getChannelLabel(row.channelId))}</td>
        <td>${renderContact(row.chatId, row.senderName, null)}</td>
        <td>${escapeHtml(row.clientMessage)}</td>
        <td>${renderDeliveryStatus(row.deliveryStatus)}</td>
        <td>
          <form method="post" action="/dashboard/pending/${row.id}/reopen">
            <button type="submit">Reabrir</button>
          </form>
        </td>
      </tr>`,
    )
    .join("");

  return `
    <details>
      <summary>Resueltas recientemente (últimas ${rows.length})</summary>
      <table>
        <thead><tr>
          <th>Atendido el</th><th>Canal</th><th>Contacto</th><th>Mensaje del cliente</th>
          <th>Entrega</th><th>Acción</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
      <p class="note">
        Solo las últimas 20, para corregir un click apurado — no es el historial completo (para eso
        está "Resultados" en Detalle). "Reabrir" la vuelve a poner en "Pendientes de revisión".
      </p>
    </details>`;
}

function renderChannels(rows: ChannelCount[]): string {
  if (rows.length === 0) {
    return `<p class="empty">Todavía no hay canales con actividad.</p>`;
  }

  const body = rows
    .map(
      (row) => `
      <tr>
        <td>${escapeHtml(getChannelLabel(row.channelId))}</td>
        <td class="num">${row.conversations}</td>
        <td class="num">${row.messages}</td>
      </tr>`,
    )
    .join("");

  return `
    <table>
      <thead><tr><th>Canal</th><th class="num">Conversaciones</th><th class="num">Mensajes</th></tr></thead>
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
  ${renderPrimarySummary(data.total, data.needsHumanReview, data.resolvedReviewCount)}

  <h2>Pendientes de revisión</h2>
  <p class="note">
    Siempre la cola completa y actual — no se ve afectada por el filtro de fecha de la sección
    "Detalle" de más abajo.
  </p>
  ${renderPendingReview(data.pendingReview, data.categoryLabels, data.filters, data.hasMultipleChannels)}
  ${renderRecentlyResolved(data.recentlyResolved)}

  <hr class="section-divider">
  <p class="sub section-label">Detalle — cómo viene funcionando el bot</p>
  <p class="sub">Período: ${escapeHtml(periodo)}</p>
  ${renderFilters(data.filters)}

  <h2>Resultados</h2>
  ${renderDetailOutcomes(data.outcomes)}

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
    Incluye el delay configurable antes de responder (0 por defecto), así que refleja la espera real
    del cliente, no la velocidad de procesamiento interna.
  </p>

  ${
    data.hasMultipleChannels
      ? `<h2>Volumen por canal</h2>
  ${renderChannels(data.byChannel)}`
      : ""
  }
</body>
</html>`;
}
