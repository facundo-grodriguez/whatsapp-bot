import { z } from "zod";

/**
 * `z.coerce.boolean()` de Zod hace `Boolean(valor)`, así que el string "false"
 * (no vacío) se coerciona a `true` — justo al revés de lo esperado en un .env.
 * Este helper interpreta explícitamente "true"/"1" y "false"/"0".
 */
const booleanFromEnvString = z.preprocess((value) => {
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (["true", "1"].includes(normalized)) return true;
  if (["false", "0", ""].includes(normalized)) return false;
  return value;
}, z.boolean());

/** Trata un string vacío como "no seteado", para variables opcionales dejadas en blanco en .env. */
const optionalNonEmptyString = z.preprocess((value) => {
  if (value === "") return undefined;
  return value;
}, z.string().min(1).optional());

/**
 * Esquema de variables de entorno. Falla rápido y con un mensaje claro si falta
 * algo al arrancar el proceso, en vez de fallar más tarde en un punto oscuro del código.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),

  // Servidor
  PORT: z.coerce.number().int().positive().default(3001),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),

  // Base de datos (libsql apuntando a un archivo local en Fase 1)
  DATABASE_URL: z.string().min(1).default("file:./data/bot.db"),

  // WAHA
  WAHA_BASE_URL: z.string().url().default("http://localhost:3000"),
  WAHA_API_KEY: z.string().min(1, "WAHA_API_KEY es requerida"),
  // HMAC del webhook: opcional en desarrollo, pero si está configurada se valida siempre.
  WAHA_HMAC_KEY: optionalNonEmptyString,
  // En dry-run el cliente de WAHA loguea la respuesta en vez de enviarla de verdad.
  // Permite probar todo el flujo sin tener WAHA corriendo.
  WAHA_DRY_RUN: booleanFromEnvString.default(false),

  // Comportamiento del bot
  RESPONSE_DELAY_MIN_MS: z.coerce.number().int().nonnegative().default(1000),
  RESPONSE_DELAY_MAX_MS: z.coerce.number().int().nonnegative().default(3000),

  // Dashboard (Fase 3). Es opcional a propósito: si no hay password configurada,
  // la ruta /dashboard no se monta (ver src/server.ts). Así una feature secundaria
  // nunca impide que arranque el bot, y nunca se sirve un dashboard sin proteger.
  DASHBOARD_USERNAME: z.string().min(1).default("admin"),
  DASHBOARD_PASSWORD: optionalNonEmptyString,
});

export type Env = z.infer<typeof envSchema>;

function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    console.error("Configuración inválida. Revisá las siguientes variables de entorno:");
    for (const issue of parsed.error.issues) {
      console.error(`  - ${issue.path.join(".")}: ${issue.message}`);
    }
    process.exit(1);
  }

  if (parsed.data.RESPONSE_DELAY_MIN_MS > parsed.data.RESPONSE_DELAY_MAX_MS) {
    console.error(
      "Configuración inválida: RESPONSE_DELAY_MIN_MS no puede ser mayor a RESPONSE_DELAY_MAX_MS",
    );
    process.exit(1);
  }

  return parsed.data;
}

export const env = loadEnv();
