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

  // Meta WhatsApp Cloud API (src/messaging/cloudApi/) — único proveedor de
  // mensajería (reemplaza a WAHA por completo, ver CLAUDE.md §5).
  META_GRAPH_BASE_URL: z.string().url().default("https://graph.facebook.com"),
  // Meta deprecia versiones de la Graph API con ~2 años de aviso: dejarla
  // configurable evita tener que tocar código para subir de versión.
  META_GRAPH_API_VERSION: z
    .string()
    .regex(/^v\d+\.\d+$/, "formato esperado: v21.0")
    .default("v21.0"),
  // Id del número de WhatsApp Business (NO el número en sí, ver App Dashboard de
  // Meta > WhatsApp > API Setup). Default del script de simulación; los envíos
  // de respuesta real usan el channelId que vino en el webhook.
  META_PHONE_NUMBER_ID: z.string().min(1, "META_PHONE_NUMBER_ID es requerido"),
  META_ACCESS_TOKEN: z.string().min(1, "META_ACCESS_TOKEN es requerido"),
  // App Secret de la app de Meta (NO el access token): con esto se verifica la
  // firma X-Hub-Signature-256 de cada webhook. Opcional en development/test,
  // OBLIGATORIA en producción (ver chequeo cruzado más abajo) — sin ella,
  // cualquiera que adivine la URL del webhook puede mandar mensajes falsos como
  // si vinieran de Meta. Más importante que con WAHA: este webhook es público
  // por definición (Meta exige HTTPS accesible, WAHA vivía en localhost).
  META_APP_SECRET: optionalNonEmptyString,
  // Token arbitrario elegido por nosotros y cargado también en el App Dashboard:
  // es lo que responde el GET de verificación del webhook (hub.verify_token).
  // Mismo criterio que META_APP_SECRET: opcional en dev, obligatorio en producción.
  META_VERIFY_TOKEN: optionalNonEmptyString,
  // En dry-run no se manda nada real a Meta: solo se loguea qué se hubiera enviado.
  // Permite probar todo el flujo sin credenciales reales de Meta.
  META_DRY_RUN: booleanFromEnvString.default(false),

  // Comportamiento del bot. Default 0: con WAHA este delay era una mitigación
  // anti-ban (no parecer un bot); con la API oficial no hay riesgo de ban por
  // comportamiento, así que responder al instante es la mejor demo posible de
  // la propuesta de valor ("hoy tardan 4hs"). Las variables se mantienen por si
  // se quiere volver a un delay por pura preferencia de UX (ver README).
  RESPONSE_DELAY_MIN_MS: z.coerce.number().int().nonnegative().default(0),
  RESPONSE_DELAY_MAX_MS: z.coerce.number().int().nonnegative().default(0),

  // Cuántos mensajes de conversaciones DISTINTAS se procesan en paralelo (ver
  // src/queue/messageQueue.ts). Dentro de una misma conversación siempre se
  // procesa de a uno y en orden, sea cual sea este valor — evita condiciones de
  // carrera sobre el estado de esa conversación (doble derivación, etc.).
  QUEUE_CONCURRENCY: z.coerce.number().int().positive().default(10),

  // Dashboard (Fase 3). Es opcional a propósito: si no hay password configurada,
  // la ruta /dashboard no se monta (ver src/server.ts). Así una feature secundaria
  // nunca impide que arranque el bot, y nunca se sirve un dashboard sin proteger.
  DASHBOARD_USERNAME: z.string().min(1).default("admin"),
  DASHBOARD_PASSWORD: optionalNonEmptyString,

  // IA (Fase 4). Apagado por defecto a propósito: es la única pieza del sistema que
  // tiene costo por request, así que hay que prenderla explícitamente en vez de que
  // alcance con poner una API key. Si está prendida, sí hace falta OPENAI_API_KEY.
  AI_FALLBACK_ENABLED: booleanFromEnvString.default(false),
  OPENAI_API_KEY: optionalNonEmptyString,
  OPENAI_MODEL: z.string().min(1).default("gpt-4o-mini"),
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

  if (parsed.data.AI_FALLBACK_ENABLED && !parsed.data.OPENAI_API_KEY) {
    console.error(
      "Configuración inválida: AI_FALLBACK_ENABLED=true requiere OPENAI_API_KEY",
    );
    process.exit(1);
  }

  if (parsed.data.NODE_ENV === "production" && !parsed.data.META_APP_SECRET) {
    console.error(
      "Configuración inválida: META_APP_SECRET es obligatoria con NODE_ENV=production " +
        "(sin ella, el webhook no puede verificar que los mensajes vienen realmente de Meta)",
    );
    process.exit(1);
  }

  if (parsed.data.NODE_ENV === "production" && !parsed.data.META_VERIFY_TOKEN) {
    console.error(
      "Configuración inválida: META_VERIFY_TOKEN es obligatoria con NODE_ENV=production " +
        "(sin ella, Meta no puede verificar la Callback URL del webhook)",
    );
    process.exit(1);
  }

  return parsed.data;
}

export const env = loadEnv();
