# CLAUDE.md — Estado y reglas del proyecto "Whatsapp"

> Este documento es la memoria viva del proyecto. Se actualiza al finalizar cada tarea importante.
> Su autoridad está subordinada a [`CONSTITUTION.md`](./CONSTITUTION.md), que es el documento
> prioritario (ver sección "Precedencia" ahí). Este archivo solo especializa esa constitución para
> este proyecto puntual — nunca la contradice en silencio.

## 1. Qué es este proyecto

Bot de atención al primer contacto por WhatsApp: responde FAQs automáticamente, detecta intención
de compra y deriva a un vendedor humano. Pensado para escalar en 4 fases sin retrabajo (ver
sección 4). Detalle de uso en [`README.md`](./README.md).

**Etapa actual: MVP.** Fase 1 completa e implementada.

## 2. Decisiones tomadas

| Decisión | Elección | Notas |
|---|---|---|
| Conexión a WhatsApp | WAHA (self-hosted, Docker) | Ver **riesgo** en sección 6 — no es la API oficial de Meta |
| Lógica de respuesta | Motor de reglas por keywords (Fase 1) | Reemplazable por IA en Fase 4 sin tocar el resto del sistema (interfaz `ResponseEngine`) |
| Stack | Node.js + TypeScript, ESM | `p-queue` v9 es ESM-only |
| HTTP | Fastify 5 | Logger pino integrado, content-type parser custom para capturar el raw body (HMAC) |
| Base de datos | SQLite vía `@libsql/client` + Drizzle ORM | Decisión explícita del usuario: evita compilar módulos nativos en Windows (alternativa a better-sqlite3) |
| Cola de procesamiento | `p-queue` en memoria, concurrency 1 | El mensaje se persiste antes de encolar; un crash pierde a lo sumo una autorespuesta, nunca el registro |
| TypeScript | Pinneado a 6.x, no a 7.x | TS7 (compilador nativo, GA jul-2026) todavía no tiene API programática estable (llega en 7.1); mejor estabilidad en 6.x para el MVP |
| Testing | Vitest solo sobre `/engine` | Lógica pura de alto valor; es la pieza que se reemplaza en Fase 4 |

## 3. Estado de módulos — Fase 1 (completa)

| Módulo | Estado | Notas |
|---|---|---|
| `config/` (env, rules, purchaseIntent, messages, categories) | ✅ | 4 FAQs + 1 regla de intención de compra de ejemplo |
| `db/` (schema, cliente, migraciones, repositorios) | ✅ | Conversación identificada por `(sessionName, chatId)` — ya lista para Fase 2 |
| `engine/` (RulesEngine detrás de `ResponseEngine`) | ✅ | 21 tests de Vitest en verde |
| `waha/` (cliente `sendText`, tipos de payload) | ✅ | Timeout 10s, errores tipados (`WahaApiError`), modo dry-run |
| `conversation/` (orquestador, `notifyVendor` stub) | ✅ | `notifyVendor` es un stub que solo loguea — ver sección 5 |
| `webhook/` (HMAC, validación, filtros, Fastify) | ✅ | Filtra `fromMe`, grupos (`@g.us`), eventos que no son `message`; idempotente ante reintentos de WAHA |
| `queue/` (p-queue) | ✅ | Errores dentro de una tarea encolada nunca escapan sin catch (evita crash del proceso) |
| README / `.env.example` / script de simulación | ✅ | `npm run simulate -- "texto"` prueba todo el flujo sin WAHA conectado |

Verificado manualmente end-to-end (servidor real + `curl`/`npm run simulate`, dry-run): FAQ,
intención de compra → derivación, silencio post-derivación, idempotencia ante webhook duplicado,
filtro de grupos y de `fromMe`, integridad referencial de categorías (FK real, no solo a nivel
aplicación).

## 4. Roadmap de fases (contexto para no romper el camino a futuro)

1. **Fase 1 (actual, completa):** motor de reglas, una sesión, sin dashboard.
2. **Fase 2:** multi-sesión. La API de WAHA (`POST /api/sendText` con `session` en el body, no en
   la URL) y el modelo de datos `(sessionName, chatId)` ya están preparados — no debería requerir
   migración.
3. **Fase 3:** dashboard de analítica + confiabilidad (healthcheck, PM2, modo degradado). Los
   índices de `messages`/`conversations` para las agregaciones ya existen desde la Fase 1.
4. **Fase 4:** IA vía Vercel AI SDK, reemplazando `RulesEngine`. Único punto de cambio:
   `src/engine/index.ts`. El resto del sistema no debería tocarse gracias a la interfaz
   `ResponseEngine` (ver `src/engine/types.ts`).

## 5. Riesgos conocidos

- **WAHA usa métodos no oficiales para conectarse a WhatsApp** y puede resultar en el baneo del
  número. Decisión ya tomada y aceptada para el MVP. Reevaluar contra la Cloud API oficial de Meta
  antes de producción con clientes reales.
- **`notifyVendor()` es un stub** (solo loguea por consola). No hay todavía un canal real de
  notificación al vendedor (WhatsApp interno, email, Slack, etc.). Implementarlo es la pieza que
  falta para que la derivación sea utilizable en la práctica, no solo registrada en la base.
- **Sin reintentos si falla el envío a WAHA**: si `sendText` tira error, el mensaje se persiste
  igual (marcado `needsHumanReview`) pero no se reintenta el envío. Aceptable para el MVP; la Fase
  3 (modo degradado, confiabilidad) es donde correspondería resolverlo.
- Vulnerabilidad moderada de `esbuild` en la cadena de dependencias de `drizzle-kit` (herramienta
  de desarrollo, no corre en producción). `npm audit` la reporta; el fix disponible rompe
  compatibilidad (downgrade grande de `drizzle-kit`). No se aplicó por no justificar el riesgo real
  en una herramienta dev-only. Revisar si `drizzle-kit` publica una versión que la resuelva.

## 6. Próximos pasos

1. Definir con el usuario cuándo arrancar la Fase 2 (multi-sesión) o si primero conviene un canal
   real para `notifyVendor()`.
2. Conectar un número de WhatsApp real a WAHA y validar el flujo end-to-end (hasta ahora todo se
   verificó en modo dry-run — ver README, sección "Conectar un número real de WhatsApp").
3. Cargar las FAQs reales del negocio en `src/config/rules.ts` (las actuales son de ejemplo).

## 7. Adaptaciones a CONSTITUTION.md

Ninguna. Las decisiones específicas del proyecto (SQLite vía libsql, TypeScript 6.x, etc.) son
elecciones técnicas dentro del margen que la Constitución deja abierto, no excepciones a sus
reglas.

## 8. Convenciones específicas de este proyecto

Hereda las convenciones generales de `CONSTITUTION.md` (variables en inglés, comentarios en
español, Conventional Commits, etc.). Adicional a esto:

- El motor de reglas (`src/engine/`) no importa nada de `db/` ni `waha/`, ni siquiera tipos — es
  una regla de diseño explícita (ver comentario en `src/engine/types.ts`) para que la Fase 4 pueda
  reemplazarlo sin arrastrar dependencias.
- Todo lo específico del negocio (FAQs, palabras de intención de compra, mensajes) vive en
  `src/config/`, nunca hardcodeado en `engine/` ni en `conversation/`.
