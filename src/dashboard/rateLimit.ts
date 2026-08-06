/**
 * Rate limiting en memoria para los intentos de login del dashboard (Basic
 * Auth) — dificulta la fuerza bruta de credenciales. Mismo patrón que el
 * throttle de modo degradado (`conversation/degradedMode.ts`): vive en
 * memoria, se resetea si el proceso reinicia. Aceptado: es una capa
 * adicional, no la única defensa (las credenciales igual deben cambiarse
 * antes de exponer el dashboard, ver CLAUDE.md sección 7).
 *
 * Cuenta solo intentos fallidos (401): un uso normal y frecuente del
 * dashboard con credenciales correctas nunca se ve afectado, y el contador se
 * resetea apenas una request autentica bien.
 *
 * Importante si el hosting final pone un reverse proxy adelante: esto usa
 * `request.ip`, que sin `trustProxy` configurado en Fastify devuelve la IP
 * del proxy para todo el tráfico (todas las requests comparten el mismo
 * límite). Si se agrega un proxy, sumar `trustProxy` a la config de Fastify
 * para que vuelva a distinguir IPs reales.
 */

const MAX_FAILED_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;

interface AttemptWindow {
  count: number;
  windowStart: number;
}

const attemptsByIp = new Map<string, AttemptWindow>();

/** ¿Esta IP ya superó el límite de intentos fallidos dentro de la ventana actual? */
export function isRateLimited(ip: string): boolean {
  const entry = attemptsByIp.get(ip);
  if (!entry) {
    return false;
  }

  if (Date.now() - entry.windowStart >= WINDOW_MS) {
    attemptsByIp.delete(ip);
    return false;
  }

  return entry.count >= MAX_FAILED_ATTEMPTS;
}

/** Registra un intento fallido para esta IP (abre una ventana nueva si la anterior venció). */
export function recordFailedAttempt(ip: string): void {
  const now = Date.now();
  const entry = attemptsByIp.get(ip);

  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    attemptsByIp.set(ip, { count: 1, windowStart: now });
    return;
  }

  entry.count += 1;
}

/** Resetea el contador de una IP — se llama al autenticar con éxito. */
export function resetAttempts(ip: string): void {
  attemptsByIp.delete(ip);
}
