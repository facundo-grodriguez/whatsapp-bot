const DATE_PARAM_REGEX = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Parsea un `YYYY-MM-DD` del querystring interpretándolo en la zona horaria local
 * del servidor, no en UTC.
 *
 * `new Date("2026-08-01")` da medianoche **UTC**: en Argentina (UTC-3) eso es las
 * 21:00 del día anterior, así que el filtro "hoy" quedaría corrido 3 horas.
 * Construyendo con `new Date(año, mes, día, ...)` la fecha se interpreta local.
 *
 * @param endOfDay si es true devuelve las 23:59:59.999 (para el límite superior
 *        de un rango, que debe incluir el día completo en vez de cortar a las 00:00).
 */
export function parseDateParam(value: unknown, endOfDay = false): Date | undefined {
  if (typeof value !== "string") return undefined;

  const match = DATE_PARAM_REGEX.exec(value.trim());
  if (!match) return undefined;

  const [, year, month, day] = match;
  const parsed = endOfDay
    ? new Date(Number(year), Number(month) - 1, Number(day), 23, 59, 59, 999)
    : new Date(Number(year), Number(month) - 1, Number(day), 0, 0, 0, 0);

  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}

/** Formatea una fecha como `YYYY-MM-DD` local, para repoblar el form de filtros. */
export function formatDateParam(date: Date | undefined): string {
  if (!date) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
