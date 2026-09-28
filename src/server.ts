import Fastify from "fastify";

import { CATEGORIES } from "./config/categories.js";
import { env } from "./config/env.js";
import { registerDashboardRoutes } from "./dashboard/routes.js";
import { checkDatabaseHealth } from "./db/health.js";
import { upsertCategories } from "./db/repositories/categories.js";
import { registerWebhookRoutes } from "./webhook/routes.js";

// La augmentation de FastifyRequest.rawBody vive en src/types/fastify.d.ts.
// No necesita import: TypeScript la incluye automáticamente por estar dentro
// de src/**/* (ver "include" en tsconfig.json).

async function main() {
  const fastify = Fastify({
    logger: {
      level: env.LOG_LEVEL,
      transport: env.NODE_ENV === "development" ? { target: "pino-pretty" } : undefined,
    },
  });

  // Content-type parser custom: además de parsear el JSON, guarda el body crudo
  // en request.rawBody para poder verificar la firma X-Hub-Signature-256 de Meta
  // sobre los bytes originales (ver messaging/cloudApi/signature.ts). Más
  // crítico que con WAHA: Meta firma bytes exactos, un JSON re-serializado
  // nunca va a coincidir.
  fastify.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (request, body, done) => {
      // Con { parseAs: "buffer" } siempre llega un Buffer; el tipo declarado por
      // Fastify admite string | Buffer porque la misma firma se comparte con
      // parseAs: "string". Se normaliza igual por prolijidad de tipos.
      const buffer = typeof body === "string" ? Buffer.from(body) : body;
      request.rawBody = buffer;
      if (buffer.length === 0) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(buffer.toString("utf8")));
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );

  // Parser mínimo de forms HTML clásicos (sin JS de cliente, ver src/dashboard/):
  // el botón "Marcar como atendido" es un <form method="post"> normal. Se resuelve
  // con `URLSearchParams`, ya nativo de Node — no hace falta sumar una dependencia
  // como @fastify/formbody para esto.
  fastify.addContentTypeParser(
    "application/x-www-form-urlencoded",
    { parseAs: "string" },
    (_request, body, done) => {
      // Con { parseAs: "string" } siempre llega un string; el tipo declarado admite
      // Buffer porque la misma firma se comparte con parseAs: "buffer" (igual que en
      // el parser de JSON de arriba).
      const text = typeof body === "string" ? body : body.toString("utf8");
      try {
        done(null, Object.fromEntries(new URLSearchParams(text)));
      } catch (error) {
        done(error as Error, undefined);
      }
    },
  );

  // Headers de seguridad básicos en toda respuesta (no solo el dashboard): son
  // inofensivos para el webhook/health (APIs JSON) y mitigan clickjacking/MIME
  // sniffing en el HTML del dashboard. Sin CSP a propósito: el dashboard tiene
  // un <style> inline (ver dashboard/render.ts) y no vale la pena auditar todo
  // el HTML server-rendered para una superficie chica de uso interno/admin.
  //
  // Referrer-Policy "same-origin" (no "no-referrer"): mismo criterio de
  // privacidad hacia afuera (no se filtra el Referer a otros sitios), pero
  // "no-referrer" rompía en la práctica los <form> del propio dashboard
  // ("Marcar como atendido", "Reactivar bot") — el navegador no manda Origin
  // en esa navegación same-origin y, sin Referer tampoco, requireSameOrigin
  // (ver dashboard/csrf.ts) no tenía con qué validar y rechazaba con 403.
  // Descubierto probando a mano contra el server real (2026-08-06).
  fastify.addHook("onSend", async (_request, reply, payload) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("X-Frame-Options", "DENY");
    reply.header("Referrer-Policy", "same-origin");
    return payload;
  });

  // Sin autenticación a propósito: lo consume un monitor externo (UptimeRobot y
  // similares), que no manda credenciales.
  fastify.get("/health", async (_request, reply) => {
    const dbOk = await checkDatabaseHealth();
    if (!dbOk) {
      return reply.code(503).send({ status: "error", db: "unreachable" });
    }
    return reply.send({ status: "ok", db: "ok" });
  });

  await registerWebhookRoutes(fastify);

  // El dashboard solo se monta si hay una contraseña configurada: nunca se sirve
  // sin protección, y su ausencia no impide que el bot funcione.
  if (env.DASHBOARD_PASSWORD) {
    await registerDashboardRoutes(fastify);
  } else {
    fastify.log.warn(
      "DASHBOARD_PASSWORD no está configurada: la ruta /dashboard no se monta. " +
        "Seteala en .env para habilitar el dashboard.",
    );
  }

  // El catálogo de categorías se sincroniza en cada arranque (no solo al migrar):
  // así nunca queda desalineado si se agrega una FAQ nueva en config/rules.ts.
  await upsertCategories(CATEGORIES);

  await fastify.listen({ port: env.PORT, host: "0.0.0.0" });

  const shutdown = async (signal: string) => {
    fastify.log.info(`Recibida señal ${signal}, cerrando servidor...`);
    try {
      await fastify.close();
      process.exit(0);
    } catch (error) {
      fastify.log.error(error, "Error cerrando el servidor");
      process.exit(1);
    }
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error) => {
  console.error("Error fatal al arrancar el servidor:", error);
  process.exit(1);
});
