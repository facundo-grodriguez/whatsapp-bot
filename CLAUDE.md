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
| `config/` (env, rules, purchaseIntent, messages, categories) | ✅ | 4 FAQs + 1 regla de intención de compra de ejemplo; cada regla/mensaje tiene variantes de respuesta (`responses: string[]`), no un texto único |
| `db/` (schema, cliente, migraciones, repositorios) | ✅ | Conversación identificada por `(sessionName, chatId)` — ya lista para Fase 2 |
| `engine/` (RulesEngine detrás de `ResponseEngine`) | ✅ | 23 tests de Vitest en verde. Elige variante de respuesta al azar vía `engine/variant.ts` (mitigación de ban, ver sección 5) |
| `waha/` (cliente `sendText`/`startTyping`/`stopTyping`, tipos de payload) | ✅ | Timeout 10s, errores tipados (`WahaApiError`), modo dry-run. `startTyping`/`stopTyping` nunca tiran (cosmético) |
| `conversation/` (orquestador, `notifyVendor` stub) | ✅ | `notifyVendor` es un stub que solo loguea — ver sección 5. Antes de enviar: delay aleatorio 1-3s + `startTyping`/`stopTyping` (mitigación de ban) |
| `webhook/` (HMAC, validación, filtros, Fastify) | ✅ | Filtra `fromMe`, grupos (`@g.us`), eventos que no son `message`, y `body` vacío (burst de sync al vincular sesión — ver sección 5); idempotente ante reintentos de WAHA |
| `queue/` (p-queue) | ✅ | Errores dentro de una tarea encolada nunca escapan sin catch (evita crash del proceso) |
| README / `.env.example` / script de simulación | ✅ | `npm run simulate -- "texto"` prueba todo el flujo sin WAHA conectado |

Verificado manualmente end-to-end (servidor real + `curl`/`npm run simulate`, dry-run): FAQ,
intención de compra → derivación, silencio post-derivación, idempotencia ante webhook duplicado,
filtro de grupos y de `fromMe`, integridad referencial de categorías (FK real, no solo a nivel
aplicación).

## 4. Roadmap de fases (contexto para no romper el camino a futuro)

1. **Fase 1 (completa):** motor de reglas, sin dashboard. FAQs cargadas son de ejemplo/simuladas
   (decisión explícita: se prioriza tener el flujo completo funcionando antes que datos reales del
   negocio — ver sección 6).
2. **Fase 2 (verificada, sin código nuevo):** multi-sesión. Confirmado con un script de
   verificación end-to-end (dos sesiones, mismo `chatId`) que ya no hay que tocar código: IDs de
   conversación distintos, sin cruce de historial, derivación aislada por sesión, envío por la
   sesión correcta. Documentado en README, sección "Fase 2 — multi-sesión". Falta únicamente dar de
   alta la sesión en WAHA cuando haya un segundo número real.
3. **Fase 3:** dashboard de analítica + confiabilidad (healthcheck, PM2, modo degradado). Los
   índices de `messages`/`conversations` para las agregaciones ya existen desde la Fase 1.
4. **Fase 4:** IA vía Vercel AI SDK, reemplazando `RulesEngine`. Único punto de cambio:
   `src/engine/index.ts`. El resto del sistema no debería tocarse gracias a la interfaz
   `ResponseEngine` (ver `src/engine/types.ts`).

## 5. Riesgos conocidos

- **WAHA usa métodos no oficiales para conectarse a WhatsApp** y puede resultar en el baneo del
  número. Decisión ya tomada y aceptada para el MVP. Reevaluar contra la Cloud API oficial de Meta
  antes de producción con clientes reales. Mitigaciones de código ya implementadas para reducir (no
  eliminar) el riesgo: delay aleatorio 1-3s antes de responder, indicador de "escribiendo…"
  (`startTyping`/`stopTyping`), y variantes de respuesta para no repetir siempre el mismo texto
  exacto (ver README, sección "Anti-ban"). Pendiente/fuera de alcance de código: cool-down/backoff
  ante errores repetidos de sesión de WAHA — encaja con el "modo degradado" de la Fase 3, no se
  implementó ahora. El factor que más pesa (número con SIM real y "calentado", solo responder a
  entrantes) es operativo, no de código, y el usuario ya usa números con antigüedad real.
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
- **Hallazgo real al conectar por primera vez (2026-08-01): WAHA reenvía un burst de eventos
  "message" con `body` vacío al vincular una sesión** — es la sincronización inicial del historial
  de WhatsApp del engine WEBJS, no mensajes nuevos reales. Sin filtro, cada uno disparaba una
  autorespuesta real a decenas de contactos que nunca escribieron nada. **Mitigado**: el webhook
  (`src/webhook/routes.ts`) ahora ignora cualquier evento con `body` vacío (mismo lugar que los
  filtros de `fromMe` y grupos).
- **Riesgo de privacidad confirmado en la práctica: conectar un número personal expone conversaciones
  reales y ajenas al bot.** Durante la misma prueba, una conversación real y en curso de un contacto
  del usuario quedó capturada por el webhook (el bot no puede distinguir "cliente preguntando por
  el negocio" de "amigo escribiéndole al dueño del número"). No se envió nada real (dry-run activo),
  pero la conversación quedó persistida en la base de desarrollo sin que esa persona lo supiera. Se
  resolvió cerrando la sesión de WAHA y borrando la base de datos de desarrollo. **No es un bug de
  código, es inherente a usar un número personal/compartido.** Recomendación firme antes de dejar
  el bot corriendo por un período largo: usar un número dedicado exclusivamente al negocio.

## 6. Próximos pasos

Orden acordado con el usuario: (1) FAQs → (2) conectar número real → (3) Fase 2.

1. ~~Cargar las FAQs reales del negocio~~ — decisión del usuario: seguir con las FAQs de ejemplo
   (`src/config/rules.ts`) como muestra/demo por ahora. Reemplazar cuando haya contenido real del
   negocio.
2. **WAHA sigue desconectada a propósito.** Se probó con el número personal del usuario, se validó
   el flujo end-to-end con un mensaje real, y se desconectó (`logout` + `stop`) por el riesgo de
   privacidad documentado en la sección 5 (capturaba conversaciones personales reales). Antes de
   reconectar para uso sostenido: conseguir un número dedicado al negocio, no personal.
3. Fase 2 (multi-sesión) — verificación y documentación ya completas (ver sección 4); solo falta
   dar de alta la sesión real en WAHA cuando corresponda.
4. Fase 3 (dashboard + confiabilidad) — siguiente en el roadmap, todavía sin arrancar.

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
