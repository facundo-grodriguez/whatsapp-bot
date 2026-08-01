import { createHash, timingSafeEqual } from "node:crypto";

import type { FastifyReply, FastifyRequest } from "fastify";

import { env } from "../config/env.js";

/**
 * Compara dos strings en tiempo constante, sin filtrar su longitud.
 *
 * `timingSafeEqual` exige buffers del mismo largo (tira si difieren), así que en
 * vez de comparar los strings crudos se comparan sus hashes SHA-256: siempre
 * miden 32 bytes, de modo que ni el contenido ni la longitud de la credencial se
 * filtran por timing.
 */
function safeEqual(a: string, b: string): boolean {
  const hashA = createHash("sha256").update(a).digest();
  const hashB = createHash("sha256").update(b).digest();
  return timingSafeEqual(hashA, hashB);
}

interface BasicCredentials {
  username: string;
  password: string;
}

/** Parsea un header `Authorization: Basic base64(user:pass)`. */
function parseBasicAuthHeader(header: string | undefined): BasicCredentials | null {
  if (!header?.startsWith("Basic ")) {
    return null;
  }

  const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8");
  // El usuario no puede tener ":", pero la contraseña sí: se corta en el primero.
  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex === -1) {
    return null;
  }

  return {
    username: decoded.slice(0, separatorIndex),
    password: decoded.slice(separatorIndex + 1),
  };
}

/**
 * preHandler de Fastify que protege el dashboard con HTTP Basic Auth. Se registra
 * únicamente en la ruta del dashboard, nunca como hook global: `/health` debe
 * quedar accesible para un monitor externo y `/webhook/waha` para WAHA.
 *
 * Solo se usa cuando DASHBOARD_PASSWORD está configurada; si no lo está, la ruta
 * directamente no se monta (ver src/server.ts).
 */
export async function requireDashboardAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const expectedPassword = env.DASHBOARD_PASSWORD;
  if (!expectedPassword) {
    // Defensa en profundidad: si se llegara acá sin password configurada, se
    // niega el acceso en vez de dejar el dashboard abierto.
    await reply.code(503).send({ error: "dashboard_not_configured" });
    return;
  }

  const credentials = parseBasicAuthHeader(request.headers.authorization);

  // Se evalúan ambas comparaciones siempre (sin cortocircuito) para no revelar
  // por timing si lo que falló fue el usuario o la contraseña.
  const usernameOk = credentials !== null && safeEqual(credentials.username, env.DASHBOARD_USERNAME);
  const passwordOk = credentials !== null && safeEqual(credentials.password, expectedPassword);

  if (!usernameOk || !passwordOk) {
    // El header WWW-Authenticate es lo que hace que el navegador muestre su
    // prompt nativo de usuario/contraseña.
    await reply
      .code(401)
      .header("WWW-Authenticate", 'Basic realm="Dashboard", charset="UTF-8"')
      .send({ error: "unauthorized" });
  }
}
