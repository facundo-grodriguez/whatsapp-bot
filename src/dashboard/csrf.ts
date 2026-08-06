import type { FastifyReply, FastifyRequest } from "fastify";

/**
 * Mitigación de CSRF para las acciones del dashboard (`POST /dashboard/...`),
 * que son `<form>` sin JS y sin token — ver CLAUDE.md sección 7. El riesgo es
 * real por usar HTTP Basic Auth: el navegador reenvía las credenciales
 * cacheadas a cualquier POST a este host, aunque lo dispare un `<form>` en
 * otra página.
 *
 * En vez de un token (necesitaría estado del lado servidor, que Basic Auth no
 * tiene por diseño), se valida que el request venga del mismo origen: se
 * compara el host del header `Origin` (o `Referer` si el navegador no mandó
 * `Origin`) contra el header `Host` que el propio request trae. Un `<form>`
 * cross-site manda `Origin`/`Referer` con el host de la página que lo alojó,
 * nunca el nuestro — eso es lo que lo delata. Ninguno de los dos headers es
 * falsificable por JS de otro origen (a diferencia de un body o query param).
 *
 * Falla cerrado a propósito (mismo criterio que `dashboard_not_configured` en
 * auth.ts): sin `Origin` ni `Referer`, se rechaza en vez de asumir que está
 * bien — el costo es bloquear algún navegador/extensión rarísima que los
 * borre en un POST de mismo origen, aceptable para una superficie admin
 * chica.
 */

function extractHost(headerValue: string | undefined): string | null {
  if (!headerValue) {
    return null;
  }
  try {
    return new URL(headerValue).host;
  } catch {
    return null;
  }
}

export async function requireSameOrigin(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const expectedHost = request.headers.host;
  const originHost = extractHost(request.headers.origin) ?? extractHost(request.headers.referer);

  if (!expectedHost || !originHost || originHost !== expectedHost) {
    await reply.code(403).send({ error: "invalid_origin" });
  }
}
