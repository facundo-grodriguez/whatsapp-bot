import Fastify from "fastify";

import { CATEGORIES } from "./config/categories.js";
import { env } from "./config/env.js";
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
  // en request.rawBody para poder verificar la firma HMAC de WAHA sobre los
  // bytes originales (ver webhook/hmac.ts).
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

  fastify.get("/health", async () => ({ status: "ok" }));

  await registerWebhookRoutes(fastify);

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
