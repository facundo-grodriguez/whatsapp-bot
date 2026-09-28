# CLAUDE.md — Estado y reglas del proyecto "Whatsapp"

> Este documento es la memoria viva del proyecto. Se actualiza al finalizar cada tarea importante.
> Su autoridad está subordinada a [`CONSTITUTION.md`](./CONSTITUTION.md), que es el documento
> prioritario (ver sección "Precedencia" ahí). Este archivo solo especializa esa constitución para
> este proyecto puntual — nunca la contradice en silencio.

## 1. Qué es este proyecto

Bot de atención al primer contacto por WhatsApp: responde FAQs automáticamente, detecta intención
de compra y deriva a un vendedor humano. Pensado para escalar en fases sin retrabajo (ver
sección 4). Detalle de uso en [`README.md`](./README.md).

**Etapa actual: MVP, migrado a la API oficial de WhatsApp.** Fases 1, 2, 3, 4 y 5 implementadas. La
Fase 5 (2026-08-02, ver sección 3) reemplazó WAHA por la **Cloud API de Meta** como único proveedor
de mensajería — decisión tomada para no invertir tiempo en un paso intermedio no oficial, ya que
Meta da números de prueba gratis con sandbox completo. Fase 4 (IA) sigue **apagada por defecto**
(`AI_FALLBACK_ENABLED=false`): el código está probado con Vitest pero no verificado end-to-end
contra la API real de OpenAI (ver sección 3). La cuenta/app de Meta ya está creada y probada
end-to-end contra un número real (2026-08-03, ver sección 6) — quedó al descubierto y resuelto un
fix de código no anticipado (formato de destinatario para números argentinos, sección 5) que solo
aparece probando contra tráfico real, no en dry-run. Roadmap original completo. Lo que queda es
deuda técnica anotada (sección 6) y decisiones operativas (token permanente de System User, decidir
hosting, canal real de notificación al vendedor, FAQs reales).

## 2. Decisiones tomadas

| Decisión | Elección | Notas |
|---|---|---|
| Conexión a WhatsApp | **Meta WhatsApp Cloud API** (oficial) — reemplaza a WAHA (2026-08-02, Fase 5) | Sin sesión persistente ni QR: autenticación por token (temporal en dev, permanente vía System User en producción). Detrás de una interfaz `MessagingProvider` (`src/messaging/`), mismo patrón que `ResponseEngine` — única implementación hoy es `CloudApiProvider`. Ver sección 3 (Fase 5) y sección 5 (riesgos nuevos: vencimiento de token, ventana de 24hs, webhook público) |
| Lógica de respuesta | Motor híbrido: reglas por keywords + IA como fallback (Fase 4) | `HybridEngine` compone `RulesEngine` (siempre primero) y `AiEngine` (solo si no hay match Y `AI_FALLBACK_ENABLED=true`), sin tocar webhook/orquestador/DB (interfaz `ResponseEngine`) |
| Proveedor de IA (Fase 4) | OpenAI vía Vercel AI SDK (`ai` + `@ai-sdk/openai`) | Decisión explícita del usuario (no Anthropic). Modelo configurable por `OPENAI_MODEL`, default `gpt-4o-mini` |
| Alcance de la IA (Fase 4) | Solo responde con las FAQs configuradas (`src/config/rules.ts`) como contexto, nunca con conocimiento propio | Decisión explícita del usuario: prioriza no alucinar datos del negocio sobre cobertura — si no puede responder con las FAQs, cae al mismo fallback fijo que `RulesEngine` (`requiereRevisionHumana: true`) en vez de que el LLM redacte un texto |
| Stack | Node.js + TypeScript, ESM | `p-queue` v9 es ESM-only |
| HTTP | Fastify 5 | Logger pino integrado, content-type parser custom para capturar el raw body (HMAC) |
| Base de datos | SQLite vía `@libsql/client` + Drizzle ORM | Decisión explícita del usuario: evita compilar módulos nativos en Windows (alternativa a better-sqlite3) |
| Cola de procesamiento | `p-queue` en memoria, concurrencia global configurable (`QUEUE_CONCURRENCY`, default 10) | El mensaje se persiste antes de encolar; un crash pierde a lo sumo una autorespuesta, nunca el registro. Concurrencia global entre conversaciones **distintas** — dentro de una misma conversación siempre es 1 a la vez (encadenado por `conversationId`), para no correr riesgo de doble derivación o respuestas fuera de orden si el mismo cliente manda varios mensajes seguidos (ver sección 3) |
| TypeScript | Pinneado a 6.x, no a 7.x | TS7 (compilador nativo, GA jul-2026) todavía no tiene API programática estable (llega en 7.1); mejor estabilidad en 6.x para el MVP |
| Testing | Vitest sobre `/engine` y `/messaging` (2026-08-02, ampliado en Fase 5; +3 el 2026-08-03) | Lógica pura de alto valor. `AiEngine`/`HybridEngine` se testean con la llamada a OpenAI mockeada (`vi.mock("ai")`). `parseWebhook`/`verifyMetaSignature` (Cloud API) también son puras y deterministas — se agregaron ~30 tests nuevos (61 en total tras la Fase 5) porque el parser de Meta es bastante más complejo que el de WAHA (lotes anidados, tres tipos de contenido mezclados). `tests/messaging/client.test.ts` (2026-08-03, 3 tests, 64 en total): cubre `sendText` con `fetch` mockeado — específicamente el fix de formato de destinatario para Argentina, ver riesgo nuevo en sección 5. Ninguno pega a una API real ni tiene costo. El resto (webhook, repositorios, dashboard) se sigue verificando a mano con `npm run simulate`, mismo criterio que siempre |

## 3. Estado de módulos

### Fase 1 (completa)

| Módulo | Estado | Notas |
|---|---|---|
| `config/` (env, rules, purchaseIntent, messages, categories, channels) | ✅ | 8 FAQs de PrintLab 3D (cargadas 2026-08-04, ver comentario en `rules.ts`) + 1 regla de "saludo" (agregada 2026-08-06, ver abajo) + 1 regla de intención de compra; cada regla/mensaje tiene variantes de respuesta (`responses: string[]`), no un texto único. `META_APP_SECRET`/`META_VERIFY_TOKEN` obligatorias si `NODE_ENV=production` (chequeo cruzado en `loadEnv`, mismo criterio que `WAHA_HMAC_KEY` antes) — opcionales solo en development/test. `channels.ts` (2026-08-02, Fase 5): `CHANNEL_LABELS` traduce `channelId` (el `phone_number_id` de Meta, un número largo) a un nombre legible para el dashboard — sin entrada en el mapa, muestra el id crudo. **Regla "saludo" (2026-08-06)**: pedido del usuario al ver, probando con datos simulados, que un simple "hola buenas tardes" caía en "sin match" y quedaba en la cola de revisión — no tenía sentido pedirle a un humano que revise un saludo. Agregada **última** en `FAQ_RULES` a propósito: `RulesEngine` usa `.find()` (primer match gana, ver `rulesEngine.ts`), así que un mensaje como "hola, ¿cuál es el horario?" sigue matcheando la regla de horarios primero — "saludo" solo gana cuando el mensaje es un saludo puro, sin ninguna consulta reconocible. Verificado a mano: ambos casos responden lo esperado, y el saludo puro no aparece en "Pendientes de revisión" (matchear cualquier FAQ pone `requiereRevisionHumana: false`, ver `rulesEngine.ts`). **Label de `CATEGORY_SIN_MATCH` renombrado** el mismo día, mismo pedido: "Sin match (revisión humana)" → "Sin match (a revisar)" en `categories.ts` — más corto, mismo significado, es lo que ve el negocio en el dashboard |
| `db/` (schema, cliente, migraciones, repositorios) | ✅ | Conversación identificada por `(channelId, chatId)` — antes `(sessionName, chatId)`, renombrado en la Fase 5 (`channelId` guarda el `phone_number_id` de Meta, pero el nombre se mantiene neutro por la misma regla de aislamiento que `engine/types.ts`). `conversations.resolvedAt` (Fase 5): cuándo se reactivó el bot en una conversación derivada, ver fila de "Reactivar bot" más abajo |
| `engine/` (RulesEngine detrás de `ResponseEngine`) | ✅ | 23 tests de Vitest en verde. Elige variante de respuesta al azar vía `engine/variant.ts` (mitigación de ban con WAHA; con Meta ya no aplica el motivo pero la feature se mantiene por variedad de respuesta, ver sección 5). `DecisionContext.sessionName` → `channelId` (Fase 5, rename mecánico, cero cambio de lógica) |
| `messaging/` (interfaz `MessagingProvider` + `cloudApi/`) | ✅ | **Reemplaza a `waha/`, borrado por completo en la Fase 5.** Mismo patrón que `ResponseEngine`: el resto del sistema depende solo de la interfaz (`sendText`, `markReadAndTyping`, `verifyWebhookSignature`, `parseWebhook`), nunca de `CloudApiProvider` directamente — selección única en `messaging/index.ts` (espejo de `engine/index.ts`). `markReadAndTyping` es una sola llamada a propósito: la Cloud API no tiene "stopTyping", el indicador se apaga solo al llegar el mensaje (o a los 25s) — el par `startTyping`/`stopTyping` de WAHA colapsó en una. `parseWebhook` es pura y determinista (nunca tira, payload irreconocible → listas vacías) — 23 tests de Vitest cubriendo lotes de N mensajes, mensajes + acuses de estado mezclados, tipos no soportados, body vacío, timestamps inválidos, y "un item malformado no tira el resto del lote". `MessagingError.retryable` clasifica códigos de Meta (`cloudApi/errorCodes.ts`): 190 (token vencido), 131047 (ventana de 24hs cerrada), 131009, 131026 → no reintentables, cualquier otro código → reintentable por default |
| `conversation/` (orquestador, `notifyVendor` stub) | ✅ | `notifyVendor` es un stub que solo loguea — ver sección 5. Antes de enviar: delay configurable (default 0 desde la Fase 5, ver sección 5) + `messaging.markReadAndTyping`. `sendTextWithRetry`: reintenta el envío del camino feliz hasta 2 veces (backoff 1s/2s), pero corta antes si el error viene `retryable: false` (Fase 5) — insistir con un token vencido no cambia el resultado, solo gasta tiempo de cola |
| `webhook/` (verificación, firma, parseo, Fastify) | ✅ | Ruta `/webhook/whatsapp` (antes `/webhook/waha`). **`GET` nuevo (Fase 5, sin equivalente en WAHA)**: responde el `hub.challenge` como texto plano si `hub.verify_token` coincide con `META_VERIFY_TOKEN` — Meta lo dispara una sola vez al cargar la Callback URL. **`POST` reescrito**: verifica `X-Hub-Signature-256` (SHA256 + prefijo `sha256=`, antes SHA512 sin prefijo) vía `messaging.verifyWebhookSignature`, un body sin `request.rawBody` capturado se reporta con motivo propio (`missing_raw_body`) en vez de caer a un fallback que nunca iba a verificar (Meta firma bytes exactos) → `parseWebhook` → itera el lote (un solo POST puede traer N mensajes de chats distintos, a diferencia de WAHA) → responde `{accepted, duplicates, ignored, statuses}`. Los filtros `fromMe` y `@g.us` de WAHA se eliminaron: código muerto con Meta (no ecoa mensajes propios como `messages`, y la Cloud API no soporta grupos) |
| `queue/` (p-queue) | ✅ | Errores dentro de una tarea encolada nunca escapan sin catch (evita crash del proceso). Concurrencia global configurable (`QUEUE_CONCURRENCY`, default 10) con serialización por `conversationId`: `Map<number, Promise<void>>` que encadena las tareas de una misma conversación entre sí antes de que compitan por los slots de la cola global — así conversaciones distintas corren en paralelo pero una misma conversación nunca corre dos mensajes a la vez, sin importar la concurrencia configurada. Cada entrada del map se autolimpia al terminar si nadie encoló nada nuevo para esa key mientras corría, para no crecer sin límite en memoria. Sin acoplamiento a WAHA ni a Meta (clave numérica `conversationId`) — no necesitó ningún cambio en la Fase 5. **Probado bajo carga**: 40 mensajes (20 conversaciones × 2) procesados en 8.6s con `QUEUE_CONCURRENCY=10` con WAHA, y de nuevo verificado en la Fase 5 vía un solo POST batcheado de Meta — en ambos casos orden preservado en las 20 conversaciones (verificado contra la base, no solo el log). Sigue siendo una prueba de desarrollo, no tráfico real sostenido |
| README / `.env.example` / script de simulación | ✅ | `npm run simulate -- "texto"` prueba todo el flujo sin cuenta de Meta. Reescrito en la Fase 5 para el payload de Meta, con `--count`/`--chats` (batching en un solo POST, antes había que disparar N requests en paralelo con WAHA), `--message-id` (prueba de idempotencia), `--status` (acuses de entrega), `--verify` (el GET de verificación) y firma automática si `META_APP_SECRET` está seteada |

Verificado manualmente end-to-end (servidor real + `curl`/`npm run simulate`, dry-run): FAQ,
intención de compra → derivación, silencio post-derivación, idempotencia ante webhook duplicado,
integridad referencial de categorías (FK real, no solo a nivel aplicación). El filtro de grupos y de
`fromMe` de WAHA se retestearon en la Fase 5 como código muerto — no hay equivalente que verificar
con Meta, ver fila de `webhook/` más arriba.

### Fase 3 (completa) — dashboard y confiabilidad

| Módulo | Estado | Notas |
|---|---|---|
| `db/repositories/stats.ts` | ✅ | Agregaciones del dashboard. Punto clave: distingue "resuelta por el bot" de "solo recibió el fallback" vía `needs_human_review` — de lo contrario los fallbacks inflarían la métrica que se le muestra al cliente. Filtra `direction = 'outbound'` en categorías (`category` nunca se persiste en inbound). `getPendingReviewMessages` (agregada 2026-08-01) devuelve el detalle fila por fila, no solo el conteo — self-join de `messages` contra sí misma (alias `inbound`) vía `inReplyToId` para recuperar el texto original del cliente. Filtra por `needsHumanReview = true` **O** `isPurchaseIntent = true`: al principio solo tenía el primero y las conversaciones "derivadas a vendedor" (leads de intención de compra) quedaban invisibles — el usuario lo notó al ver la card "Derivadas a vendedor" del dashboard sin contraparte en la lista. También excluye `reviewedAt IS NOT NULL` (marcadas como atendidas). `getResolvedReviewCount` es su contraparte exacta (mismo filtro, `reviewedAt IS NOT NULL`). La vieja `getNeedsHumanReviewCount` (query separada que alimentaba la card, con el mismo bug de antes de sumar `isPurchaseIntent`) se **eliminó**: ahora esa card usa `pendingReviewMessages.length`, misma fuente que la tabla, no puede volver a desincronizarse. `getConversationOutcomes` **excluye conversaciones sin ningún mensaje** (`hasAnyMessage`, agregado 2026-08-01): el usuario notó que "Derivadas" (6) + "Necesitan un humano" (6) = 12 no coincidía con "Pendientes por responder" (8), y la causa real eran 4 conversaciones "fantasma" en la base de desarrollo (creadas por `findOrCreateConversation` en el webhook pero sin ningún mensaje insertado después — artefactos de pruebas manuales propias con timestamps inválidos, no tráfico real) que se contaban como "necesita revisión" sin tener nada que revisar. Después de excluirlas, `total` pasó de 26 a 22. `necesitaHumano` se **renombró a `sinResolverPorBot`** (mismo pedido del usuario: el nombre "necesita humano" generaba la falsa impresión de que debía sumar exacto con "Pendientes por responder"; ver nota en `renderDetailOutcomes`). **Fase 5**: `PendingReviewItem` suma `conversationId` y `conversationState` (para el botón "Reactivar bot", ver fila de `dashboard/` más abajo); `channelId`/`sessionName` renombrado en todo el archivo |
| `db/repositories/messages.ts` (`markMessageAsReviewed`) | ✅ | Setea `reviewedAt = now()` en un mensaje puntual. Solo tiene efecto si ese mensaje de verdad tenía `needsHumanReview` o `isPurchaseIntent` — un id cualquiera en el POST no puede "resolver" un mensaje que nunca estuvo pendiente |
| `dashboard/` (auth, render, routes) | ✅ | `GET /dashboard` con HTTP Basic Auth (`DASHBOARD_USERNAME`/`PASSWORD`), montaje condicional — sin password no se monta la ruta, nunca queda sin proteger. HTML server-rendered, sin dependencias de templating, `escapeHtml` en todo valor interpolado. Sección "Pendientes de revisión" (2026-08-01): lista mensaje por mensaje con antigüedad y link directo a `wa.me/<número>` — antes solo había un conteo agregado, y la única forma de encontrar cuál conversación quedó sin resolver era ir chat por chat en WhatsApp a mano. Botón **"Marcar como atendido"** por fila (`POST /dashboard/pending/:id/resolve`, mismo `requireDashboardAuth`): `<form>` HTML sin JS, redirige 303 de vuelta a `/dashboard` preservando `?from=`/`?to=` vía hidden fields. Card "Resueltas manualmente" al lado de "Pendientes por responder". Página dividida en dos zonas (2026-08-01, pedido explícito del usuario): resumen + cola de pendientes arriba, **siempre sin filtro de fecha** (`getConversationOutcomes()`, `getPendingReviewMessages()`, `getResolvedReviewCount()` se llaman sin argumentos en `routes.ts`); el filtro `Desde`/`Hasta` se movió adentro de la sección "Detalle" y solo controla `getConversationOutcomes(detailFilters)`, `getResponseCountByCategory`, `getAvgResponseTimeMs`, `getVolumeBySession`. El `<form class="filters-form">` de filtros originalmente estaba con CSS sin scopear (`form { ... }` aplicaba a TODOS los forms de la página, incluido el botón de "marcar como atendido" dentro de una celda de tabla) — se corrigió a la vez que se movió, escopeando el selector a `.filters-form`. Botón **"Reabrir"** (2026-08-01, `POST /dashboard/pending/:id/reopen`, mismo patrón sin JS): contraparte de "Marcar como atendido" — pone `reviewedAt = null` de nuevo. Vive en un `<details>` colapsado "Resueltas recientemente (últimas 20)" (`getRecentlyResolvedMessages`, sin filtro de fecha, misma zona "siempre actual" que Pendientes) para poder corregir un click apurado sin tener que ir a buscar en "Resultados" de Detalle. **Fase 5 (2026-08-02)**: "Volumen por sesión" → "Volumen por canal" (`getVolumeBySession` → `getVolumeByChannel`), columnas "Sesión" → "Canal" en las tres tablas que las tenían, usando `getChannelLabel` (ver fila de `config/` más arriba) en vez del `channelId` crudo. Botón **"Reactivar bot"** (`POST /dashboard/conversations/:id/resolve`, mismo patrón sin JS): aparece solo en las filas de "Pendientes de revisión" cuya conversación está `derivada` — llama a `resolveConversation` (nueva, ver fila de `db/` en Fase 1), que vuelve `state` a `'activa'` y setea `resolvedAt` **sin pisar `derivedAt`** (son historiales distintos: cuándo se derivó vs. cuándo se resolvió). Es un concepto distinto de "Marcar como atendido": ese actúa sobre un mensaje puntual (`messages.reviewedAt`), este sobre el estado de toda la conversación. Cierra una brecha real: antes de la Fase 5 una conversación derivada quedaba derivada para siempre, sin ningún camino de código para reactivar el bot. **Simplificación post-conexión real (2026-08-04)**, pedida por el usuario una vez conectados a la cuenta real de Meta: (1) "Volumen por canal" ahora solo se muestra con 2+ canales activos alguna vez (`getActiveChannelCount`, sin filtro de fecha a propósito — no debe parpadear según el rango elegido); con un solo número de negocio es puro ruido. (2) La nota de "Tiempo de respuesta" ya no menciona anti-ban (dejó de aplicar en la Fase 5, ver sección 2) — ahora dice que incluye el delay configurable (0 por defecto). (3) Nueva columna "Contacto" en "Pendientes de revisión" y "Resueltas recientemente": `senderName` (nombre de perfil de WhatsApp) si Meta lo mandó alguna vez, si no cae al número — antes no había ningún identificador visible en esas tablas, solo el link "Abrir chat". (4) Nueva columna "Entrega": último acuse de estado (`sent`/`delivered`/`read`/`failed`) de la respuesta del bot, alimentado por los eventos `statuses` que el webhook ya recibía pero antes solo logueaba si eran `failed` — ahora se persisten todos vía `updateDeliveryStatus`. Verificado en vivo contra la cuenta real: `senderName` y `deliveryStatus` se completan correctamente con tráfico real de Meta |
| `dashboard/dateRange.ts` | ✅ | Filtros `?from=`/`?to=` interpretados en zona horaria **local** del server, no UTC (bug real de v1 del plan, corregido antes de implementar) |
| `server.ts` (parser `application/x-www-form-urlencoded`) | ✅ | Agregado 2026-08-01 para el `<form method="post">` de "Marcar como atendido" — el form del filtro de fecha ya existía pero era `GET`, nunca había necesitado parsear un body. Resuelto con `URLSearchParams` nativo de Node, sin sumar `@fastify/formbody` como dependencia nueva (mismo criterio que el resto del proyecto: no agregar paquetes para lo que Node ya resuelve) |
| `db/schema.ts` (`messages.reviewedAt`) | ✅ | Migración `0001_clumsy_rocket_raccoon.sql` (nombre autogenerado por drizzle-kit). Columna nullable: `null` = pendiente, con fecha = atendido. Vive en el mensaje saliente, no en la conversación, porque una conversación puede tener varios mensajes pendientes en momentos distintos. **2026-08-04**: migración `0001_illegal_sleepwalker.sql` suma `conversations.senderName` (nullable, se refresca en `findOrCreateConversation` cuando Meta manda un nombre nuevo y distinto del guardado) y `messages.deliveryStatus` (nullable, enum local `MESSAGE_DELIVERY_STATUSES` — se redeclara en vez de importar de `messaging/types.ts` para no romper el aislamiento `db/` ↔ `messaging/`, mismo criterio que `MESSAGE_DIRECTIONS`). `insertOutboundMessage` ahora también guarda `providerMessageId` (antes solo se usaba para dedupe de inbound) — necesario para poder correlacionar los `statuses` del webhook contra el mensaje saliente correcto vía `updateDeliveryStatus` |
| Modo degradado (`conversation/degradedMode.ts` + `handleIncomingMessage.ts`) | ✅ | Try/catch de nivel superior ante cualquier error no controlado → intenta mandar `DEGRADED_MODE_MESSAGE` y persistirlo (`error_interno`, `needsHumanReview: true`). Throttle en memoria (5 min/chat) para no mandar el mismo mensaje repetido si la falla persiste en varios mensajes seguidos |
| `db/health.ts` | ✅ | `GET /health` hace `count(*)` real sobre `conversations` (no `SELECT 1`, que no detectaría un schema sin migrar), devuelve 503 si falla. Sin auth: lo consume un monitor externo |
| `ecosystem.config.cjs` (PM2) | ✅ | `node_args: "--env-file=.env"` (PM2 no pasa por el script `start` de package.json) y `cwd: __dirname` (`DATABASE_URL` es relativa; sin esto, un `cwd` distinto crearía una base vacía en otro lado sin avisar) |
| `scripts/backup-db.mjs` (2026-08-01, agendado 2026-08-04) | ✅ | `npm run db:backup` copia el archivo SQLite a `backups/bot-<fecha>-<hora>.db` y poda copias viejas (retención configurable, `--keep`, default 30). Solo para `DATABASE_URL` tipo `file:...` — no hace nada si no lo es. **Agendado en el Programador de tareas de Windows** (tarea `WhatsappBotBackup`, diario 03:00, retiene 30 — default del script): corre `node --env-file=.env scripts/backup-db.mjs` con `WorkingDirectory` en la raíz del proyecto, log en `backups/backup.log` (cubierto por `*.log` en `.gitignore`). Verificado con una corrida manual (`Start-ScheduledTask`): `LastTaskResult 0`, backup nuevo creado. Es una tarea local a esta máquina — si el bot se muda a un servidor, hay que recrearla ahí (o migrar a un cron real), no viaja con el repo |

Verificado manualmente: script contra DB de prueba con los tres outcomes de conversación sembrados
a mano (confirmando que un fallback **no** cuenta como resuelto); servidor real con los tres casos
vía `npm run simulate`; auth sin/con credenciales; filtro de fecha con la fecha de hoy (confirma el
fix de timezone); error forzado temporalmente en el motor + 3 mensajes seguidos (confirma que el
throttle manda un solo mensaje degradado, no tres); `/health` en verde.

### Fase 4 (implementada, apagada por defecto) — IA como fallback

| Módulo | Estado | Notas |
|---|---|---|
| `engine/aiEngine.ts` (`AiEngine`) | ✅ | `generateObject` (Vercel AI SDK) contra OpenAI, con `system` + FAQs + historial como contexto. Devuelve `puedeResponder: false` → mismo fallback fijo que `RulesEngine`, nunca texto libre del LLM en ese caso. Timeout 15s, error tipado `AiEngineError` (mismo patrón que `WahaApiError`), sin captura propia — sube hasta `handleIncomingMessage` y activa el modo degradado de la Fase 3 |
| `engine/hybridEngine.ts` (`HybridEngine`) | ✅ | Compone `RulesEngine` + `AiEngine`. Solo llama a la IA cuando `RulesEngine` devuelve `categoria === CATEGORY_SIN_MATCH`; si `aiEngine` es `null` (flag apagado), replica el comportamiento exacto de la Fase 1 |
| `engine/index.ts` | ✅ | Único punto de selección, sin cambios en el resto del sistema (webhook/orquestador/DB no tocados, tal como preveía la interfaz desde la Fase 1) |
| `config/env.ts` (`AI_FALLBACK_ENABLED`, `OPENAI_API_KEY`, `OPENAI_MODEL`) | ✅ | Apagado por defecto (mismo patrón que `DASHBOARD_PASSWORD`: una feature con costo/dependencia externa nunca debe prenderse sola). Si `AI_FALLBACK_ENABLED=true` sin `OPENAI_API_KEY`, el servidor no arranca (falla rápido) |
| Tests (`tests/engine/aiEngine.test.ts`, `hybridEngine.test.ts`) | ✅ | 8 tests nuevos (31 en total), con `vi.mock("ai")` y `vi.mock("@ai-sdk/openai")` — nunca pegan a la API real. Cubren: respuesta vía IA, fallback fijo cuando no puede responder, que nunca marca intención de compra, que un error de la API se envuelve en `AiEngineError`, y en `HybridEngine` que las reglas siempre ganan cuando matchean (incluida intención de compra) y que sin `aiEngine` configurado el comportamiento es el de la Fase 1 |

**No verificado todavía**: llamada real contra la API de OpenAI (con `OPENAI_API_KEY` real y
`AI_FALLBACK_ENABLED=true`) ni prueba end-to-end vía `npm run simulate`/servidor real — la
verificación de esta fase fue Vitest (mockeado) + `tsc` (build limpio) únicamente. Motivo: la DB de
desarrollo local (`data/bot.db`) está sin migrar (falta la tabla `categories`), algo previo a este
cambio y sin relación con el motor — no se tocó la base para no pisar el estado que dejó el usuario
después del incidente de privacidad documentado en sección 5. Antes de prender `AI_FALLBACK_ENABLED`
por primera vez: correr `npm run db:migrate` y probar con `npm run simulate` (o directo con curl)
un mensaje que no matchee ninguna FAQ, con una `OPENAI_API_KEY` real.

## 4. Roadmap de fases (contexto para no romper el camino a futuro)

1. **Fase 1 (completa):** motor de reglas, sin dashboard. FAQs cargadas son de ejemplo/simuladas
   (decisión explícita: se prioriza tener el flujo completo funcionando antes que datos reales del
   negocio — ver sección 6).
2. **Fase 2 (verificada, sin código nuevo en su momento):** multi-sesión con WAHA, ahora
   **multi-canal con Meta** tras la Fase 5. El concepto se traslada igual: varios `channelId`
   (antes `sessionName`) comparten la misma lógica sin chocar `chatId`s, sin tocar código — la
   Fase 5 solo tuvo que renombrar el campo, no rediseñar el mecanismo. Con Meta, varios números de
   WhatsApp Business bajo la misma app comparten **un solo webhook y un solo token** (a diferencia de
   WAHA, que necesitaba una sesión + QR por número). Documentado en README, sección "Varios números".
3. **Fase 3 (completa):** dashboard de analítica + confiabilidad. Los índices de
   `messages`/`conversations` para las agregaciones, planeados desde la Fase 1, se usaron sin
   necesidad de agregar ninguno nuevo. Detalle en la sección 3 y en el README.
4. **Fase 4 (implementada, apagada por defecto):** IA vía Vercel AI SDK (OpenAI), **no** reemplazando
   `RulesEngine` sino como fallback cuando este no matchea nada (`HybridEngine`) — decisión explícita
   del usuario, distinta del plan original de reemplazo total. Único punto de cambio en
   `src/engine/index.ts`; el resto del sistema no se tocó, gracias a la interfaz `ResponseEngine`
   (ver `src/engine/types.ts`). Detalle en sección 3.
5. **Fase 5 (completa, 2026-08-02): migración de WAHA a la Cloud API oficial de Meta.** Reemplaza
   por completo el módulo de mensajería (`src/waha/` → `src/messaging/`) detrás de una interfaz
   `MessagingProvider`, mismo patrón que `ResponseEngine` — el motor de decisión, la base de datos
   (salvo el rename `sessionName`→`channelId`), la cola y el dashboard no se tocaron en su lógica.
   Resuelve de raíz dos riesgos documentados en la sección 5 (baneo del número, captura de
   conversaciones personales) y suma una feature nueva (reactivar una conversación derivada). Trae
   también restricciones nuevas que no existían con WAHA (ventana de 24hs, vencimiento de token,
   webhook público) — ver sección 5. Plan completo en
   `C:\Users\User\.claude\plans\contexto-del-proyecto-wobbly-plum.md`. Detalle en sección 3.

## 5. Riesgos conocidos

- ~~WAHA usa métodos no oficiales para conectarse a WhatsApp y puede resultar en el baneo del
  número~~ — **resuelto de raíz en la Fase 5 (2026-08-02)**: se migró a la Cloud API oficial de
  Meta, que no tiene este riesgo — no hay nada que "mitigar", el motivo de fondo desaparece. Las
  variantes de respuesta (`engine/variant.ts`) se mantienen igual, pero ahora son una decisión de UX
  (no repetir siempre el mismo texto), no una mitigación de ban.
- ~~Riesgo de privacidad: conectar un número personal expone conversaciones reales y ajenas al
  bot~~ — **resuelto de raíz en la Fase 5**: un número de WhatsApp Business en la Cloud API no tiene
  historial personal ni recibe chats que no sean del negocio — el problema deja de ser posible, no
  es una mitigación. (Se había confirmado en la práctica con WAHA: una conversación personal real de
  un contacto del usuario quedó capturada por el webhook; se resolvió en su momento cerrando esa
  sesión y borrando la base de desarrollo.)
- ~~El bot no marca los mensajes como "leídos" en WhatsApp~~ — **resuelto en la Fase 5**: la Cloud
  API sí lo permite. `messaging.markReadAndTyping` marca leído y muestra "escribiendo…" en una sola
  llamada (a diferencia de WAHA, no hay endpoint separado de "stopTyping" — el indicador se apaga
  solo al llegar el mensaje real, o a los 25s).
- **`notifyVendor()` sigue siendo un stub** (solo loguea por consola). No hay todavía un canal real de
  notificación al vendedor (WhatsApp interno, email, Slack, etc.). Implementarlo es la pieza que
  falta para que la derivación sea utilizable en la práctica, no solo registrada en la base.
  Además, **solo se llama en el caso de intención de compra** — el caso "sin match" (fallback
  genérico) no dispara `notifyVendor()` en absoluto, solo queda marcado en la base
  (`needsHumanReview: true`). La sección "Pendientes de revisión" del dashboard (ver sección 3) cubre
  el descubrimiento pull para los dos motivos — pero sigue sin haber push (notificación activa) para
  ninguno de los dos. **Nuevo con la Fase 5**: si el canal elegido termina siendo "WhatsApp interno"
  (mandarle un WhatsApp al vendedor), va a chocar con la ventana de 24hs (ver más abajo) salvo que se
  use una plantilla aprobada — no es un mensaje de respuesta a una conversación en curso con el
  vendedor, así que probablemente no hay ventana abierta.
- **"Marcar como atendido" es manual y unidireccional para el mensaje puntual** (tiene su "Reabrir",
  ver sección 3) **pero el sistema sigue sin enterarse si el vendedor responde a mano desde
  WhatsApp**, sin pasar por el dashboard — el mensaje sigue apareciendo como pendiente hasta que
  alguien lo marque. Esto no cambió con la Fase 5: la Cloud API tampoco ecoa los mensajes salientes
  propios como eventos `messages` (vuelven como `statuses`, que solo cubren lo que el bot mandó por
  API, no lo que el vendedor tipeó a mano) — el bloqueo cambió de forma pero no desapareció. Sigue
  diferido, no implementado a propósito (ver sección 6). **Camino identificado el 2026-08-04, todavía
  sin implementar**: WhatsApp Coexistence (`message_echoes`) resolvería este punto de raíz, además del
  problema de "Abrir chat" — ver punto 8 de la sección 6 para el detalle completo.
- ~~Sin reintentos si falla el envío~~ — **resuelto**: `sendTextWithRetry` en
  `conversation/handleIncomingMessage.ts` reintenta hasta 2 veces (backoff 1s, luego 2s) antes de
  resignarse — salvo que el error venga marcado `retryable: false` (Fase 5: token vencido, ventana de
  24hs cerrada), en cuyo caso corta antes, porque insistir no cambia el resultado. Mitiga, no
  elimina: si el proveedor está caído por más que esos ~3s totales, el mensaje se persiste igual
  (marcado `needsHumanReview`) pero el cliente no recibe nada en ese caso puntual. Sigue siendo
  distinto del modo degradado de la Fase 3 (que cubre errores en el resto del pipeline: motor, DB,
  etc., con throttle y mensaje de resguardo) — este es específicamente el caso "proveedor caído justo
  al mandar una respuesta válida".
- Vulnerabilidad moderada de `esbuild` en la cadena de dependencias de `drizzle-kit` (herramienta
  de desarrollo, no corre en producción). `npm audit` la reporta; el fix disponible rompe
  compatibilidad (downgrade grande de `drizzle-kit`). No se aplicó por no justificar el riesgo real
  en una herramienta dev-only. Revisar si `drizzle-kit` publica una versión que la resuelva.
- **`AI_FALLBACK_ENABLED=true` tiene costo real por request de OpenAI** (cada mensaje que no matchea
  ninguna FAQ dispara una llamada). Mitigado por estar apagado por defecto (sección 2/3), pero antes
  de prenderlo en producción con tráfico real hay que revisar el pricing vigente del modelo elegido
  (`OPENAI_MODEL`) y, si hace falta, sumar un límite de gasto o rate-limit — no implementado, no
  había un caso de uso real que lo pidiera todavía.
- **Riesgos nuevos introducidos por la Fase 5 (Cloud API de Meta), ninguno existía con WAHA:**
  - **El access token vence.** El token temporal del App Dashboard dura ~24hs; uso sostenido necesita
    un token permanente de System User (operativo, no de código, pero un tropiezo garantizado la
    primera vez). Por eso el código 190 (token vencido/inválido) se clasifica como no-reintentable
    (`cloudApi/errorCodes.ts`) y se loguea de forma distinguible — para que se diagnostique en un
    minuto, no en una hora de mirar reintentos fallando en silencio.
  - **Ventana de 24hs para mensajes de texto libre.** Solo se puede escribir fuera de una plantilla
    aprobada dentro de las 24hs desde el último mensaje del cliente. Para este bot (responde al
    instante a mensajes entrantes) prácticamente siempre se cumple — pero es la restricción a tener
    en cuenta el día que se implemente algo proactivo (ver riesgo de `notifyVendor()` arriba).
  - **El webhook necesita ser públicamente alcanzable por HTTPS**, incluso en desarrollo — a
    diferencia de WAHA, que corría contra `localhost`. Hace falta un túnel (ngrok/cloudflared) para
    probar contra la cuenta real de Meta; en producción, el hosting elegido tiene que exponer HTTPS
    válido. No resuelto todavía porque no hay cuenta de Meta creada (ver sección 6).
  - **Costo probablemente ~$0 para el patrón de uso de este bot, a confirmar.** Desde nov-2024 Meta
    dejó de cobrar las conversaciones de servicio (respuestas dentro de la ventana de 24hs); el bot
    solo responde a mensajes entrantes, sin plantillas. El supuesto original de "pago por
    conversación" probablemente sobreestima el costo real — **verificar contra el pricing vigente de
    Meta antes de cotizarle al cliente**, no asumido a ciegas.

- **Verificar la Callback URL y suscribir el campo `messages` no alcanza — hay que suscribir la app
  a la WABA.** Descubierto el 2026-08-03 probando por primera vez con la cuenta real: la Callback URL
  verificaba en verde y el campo `messages` figuraba "Suscrito" en el App Dashboard, pero ningún
  mensaje real llegaba al webhook (el botón "Test" del Dashboard sí funcionaba, porque ese manda
  directo a la Callback URL sin pasar por esta suscripción). La causa: la WABA tenía suscripta una
  app interna de Meta (`WA DevX Webhook Events 1P App`) en vez de la propia — un default que queda
  mal configurado al crear el número de prueba. Se resuelve con `POST
  /{waba-id}/subscribed_apps` (con el access token), no hay equivalente en el App Dashboard estándar.
  Verificar con `GET /{waba-id}/subscribed_apps` si vuelve a pasar (ej. con una WABA nueva).
- **Los wa_id de celulares argentinos necesitan sacarse el `9` para responder, aunque lo traigan al
  recibir.** Descubierto el 2026-08-03: un mensaje entrante de un celular argentino llega con
  wa_id `549...` (ej. `5491100000000`), pero mandarle una respuesta a ese mismo string tal cual lo
  rechaza la Cloud API (`131030 Recipient phone number not in allowed list` en sandbox — probable-
  mente también fuera de sandbox, no confirmado todavía con un número de producción real). Confirmado
  contra la API real: `5491100000000` rechazado, `541100000000` (mismo número sin el 9) aceptado y
  resuelto por Meta al mismo wa_id. Fix aplicado en `toOutboundRecipient()`
  (`src/messaging/cloudApi/client.ts`), cubierto por `tests/messaging/client.test.ts`. Acotado a
  distinguir por wa_id argentino, sin tocar números de otros países (no hay evidencia de que tengan
  el mismo quirk).

## 6. Próximos pasos

Recorrido hasta acá: (1) FAQs de ejemplo → (2) conectar WAHA con número real (probado y
desconectado por privacidad) → (3) Fase 2 verificada → Fase 3 completa (dashboard + confiabilidad) →
Fase 4 implementada, apagada por defecto (IA como fallback) →
**Fase 5 completa: migración de WAHA a la Cloud API oficial de Meta (2026-08-02)**.

1. ~~Cargar las FAQs reales del negocio~~ — decisión del usuario: seguir con las FAQs de ejemplo
   (`src/config/rules.ts`) como muestra/demo por ahora. Reemplazar cuando haya contenido real del
   negocio.
2. ~~WAHA sigue desconectada a propósito~~ — **superado por la Fase 5**: WAHA se borró del todo, ya
   no es la vía de conexión. El pendiente equivalente era **crear la cuenta/app de Meta y probar
   contra un número real — hecho el 2026-08-03**:
   - ~~Crear la app en el Meta App Dashboard, agregar WhatsApp, conseguir un número de prueba~~ —
     hecho, `META_PHONE_NUMBER_ID`/`META_ACCESS_TOKEN`/`META_APP_SECRET` reales cargados en `.env`.
   - ~~Levantar un túnel público HTTPS y cargar la Callback URL + Verify Token~~ — hecho con ngrok.
     El `GET /webhook/whatsapp` verificó en verde a la primera.
   - ~~Suscribirse al campo `messages`~~ — hecho, pero **no alcanzaba por sí solo**: hizo falta además
     suscribir la app a la WABA (`POST /{waba-id}/subscribed_apps`), un paso no documentado en el
     flujo estándar del Dashboard — ver riesgo nuevo en sección 5.
   - ~~Agregar el número propio como destinatario de prueba~~ — hecho, con la vuelta extra de que
     Meta pide el número **sin** el `15` local (o directamente con el `9`, ver mismo riesgo).
   - ~~Mandar un WhatsApp real y confirmar que llega la respuesta~~ — confirmado end-to-end el
     2026-08-03: FAQ (horarios, ubicación) y derivación por intención de compra, ambas con respuesta
     real recibida en el teléfono. Hizo falta un fix de código adicional (formato de destinatario
     para números argentinos, ver sección 5) que no estaba contemplado hasta probar con un número
     real — bien fundamentada la doc de "no verificado end-to-end" que tenía este punto antes.
   - ~~Token temporal, vence en ~24hs~~ — **resuelto el 2026-08-04**: reemplazado por un token
     permanente de System User (`type: SYSTEM_USER`, `expires_at: 0` confirmado vía
     `GET /debug_token`). El token temporal del día anterior venció una vez a mitad de las pruebas
     (confirmó en la práctica el riesgo ya documentado en sección 5) antes de este reemplazo.
   - **Sigue pendiente**: verificar el pricing vigente de Meta contra el patrón de uso real de este
     bot antes de cotizarle al cliente (ver riesgo de costo en sección 5 — probablemente sea ~$0).
3. ~~Fase 2 (multi-sesión)~~ — verificada y documentada, sin código pendiente. Con la Fase 5 pasó a
   ser "multi-canal": si en algún momento el negocio tiene más de un número de WhatsApp Business,
   agregar su `channelId` (`phone_number_id`) a `CHANNEL_LABELS` en `src/config/channels.ts` es lo
   único que hace falta para que el dashboard lo muestre con un nombre legible.
4. ~~Fase 3 (dashboard + confiabilidad)~~ — completa, ver sección 3. Pendiente solo de uso: cuando
   haya tráfico real, mirar `/dashboard` para validar que las métricas cuenten algo útil en la
   práctica (hasta ahora solo se probó con datos sembrados a mano).
5. ~~Fase 4 (IA)~~ — implementada como fallback híbrido (OpenAI, opt-in vía `AI_FALLBACK_ENABLED`,
   ver sección 3). Roadmap original completo. Pendiente de uso, no de código:
   - Probar con una `OPENAI_API_KEY` real antes de prender el flag por primera vez (la base de
     desarrollo se recreó limpia en la Fase 5, `npm run db:migrate` ya no es un pendiente).
   - Decidir si/cuándo prender `AI_FALLBACK_ENABLED=true` en producción — implica costo real por
     request, todavía no evaluado contra presupuesto (ver riesgo en sección 5).
   - Revisar si `gpt-4o-mini` (default de `OPENAI_MODEL`) sigue siendo la opción más conveniente de
     OpenAI al momento de prenderlo — no se comparó contra alternativas del catálogo vigente.
6. **Ronda de hardening (2026-08-01)**, a partir de un punchlist de 8 ítems que el usuario pidió
   evaluar antes de conectar un número real. De los 8, 3 quedaron bloqueados por depender de algo
   que solo el usuario puede definir/proveer (documentado explícitamente en vez de asumido):
   - **Canal real para `notifyVendor()`** — sigue siendo un stub. Falta decidir el canal
     (WhatsApp interno / email / Slack) y conseguir sus credenciales.
   - **FAQs reales del negocio** — sigue con las de ejemplo (`src/config/rules.ts`); no hay con qué
     reemplazarlas sin el contenido real del negocio.
   - **Probar la IA de Fase 4 con una API key real de OpenAI** — nunca se probó contra la API real
     (solo mockeada en tests), requiere una key real del usuario y tiene costo.

   Los otros 5 sí se resolvieron:
   - ~~Sin reintentos si falla el envío a WAHA~~ — resuelto, ver sección 5 y fila de `conversation/`
     en sección 3. Adaptado en la Fase 5 al vocabulario de errores de Meta (`retryable`).
   - ~~`WAHA_HMAC_KEY` opcional en producción~~ — ahora obligatoria si `NODE_ENV=production`.
     Reemplazado en la Fase 5 por `META_APP_SECRET`/`META_VERIFY_TOKEN`, mismo criterio.
   - ~~Sin backup del archivo SQLite~~ — `npm run db:backup`, ver sección 3. **Agendado el
     2026-08-04** en el Programador de tareas de Windows de esta máquina (diario 03:00, retiene 30).
     Pendiente si se muda a un servidor de producción: recrear la tarea ahí (o pasar a cron real).
   - ~~"Marcar como atendido" sin deshacer~~ — botón "Reabrir", ver sección 3.
   - Concurrencia de la cola probada con una carga más realista (40 mensajes, 20 conversaciones) —
     ver sección 3, fila de `queue/`. Reverificada en la Fase 5 con el nuevo formato batcheado de
     Meta (un solo POST con 40 mensajes en vez de 40 requests en paralelo).

   Un 9no punto salió de esta misma ronda y sigue diferido después de la Fase 5, no resuelto ni
   olvidado — ver detalle actualizado en sección 5 ("Marcar como atendido" es manual...): **detectar
   que el vendedor respondió manualmente desde WhatsApp** para autorresolver el pendiente. Con WAHA
   el bloqueo era no poder verificar el payload de `fromMe: true`; con Meta el bloqueo cambió de
   forma (la Cloud API tampoco ecoa los mensajes propios como `messages`, solo llegan como
   `statuses` de lo que el bot mandó por API) pero el resultado es el mismo: no hay señal de que el
   vendedor contestó a mano. No priorizado — no hay caso de uso real todavía que lo pida con fuerza.

7. **Auditoría de seguridad pre-deploy (2026-08-04, revisado, nada aplicado todavía — pendiente de
   que el usuario diga "dale con eso").** Se revisó el código completo de la migración de Fase 5
   (webhook, dashboard, auth, DB) antes de subir el bot a un servidor real por primera vez. Ya sano,
   sin cambios pendientes: firma HMAC del webhook obligatoria en producción, Basic Auth del
   dashboard con comparación timing-safe, sin SQL injection (Drizzle parametrizado), `escapeHtml`
   consistente en el dashboard (sin XSS), `.env`/`data/` bien gitignoreados, 0 vulnerabilidades en
   dependencias de producción (`npm audit --omit=dev`; la de esbuild/drizzle-kit es dev-only).
   Bloqueante antes de exponerlo, en orden:
   - **Cambiar las credenciales del dashboard** — hoy `DASHBOARD_USERNAME=admin` /
     `DASHBOARD_PASSWORD=dev-local-only` en `.env`, son las de desarrollo local.
   - **HTTPS delante del server** (hosting o reverse proxy) — Basic Auth manda credenciales sin
     cifrar sin TLS; Meta además lo exige igual para el webhook.
   - **Correr con `NODE_ENV=production`** en el server real — activa los chequeos obligatorios de
     `META_APP_SECRET`/`META_VERIFY_TOKEN` al arrancar (hoy el `.env` local dice `development`).
   - **Cargar las variables de entorno por el mecanismo del hosting** (secrets del proveedor), no un
     `.env` copiado a mano al server.

   No bloqueante, nice-to-have — los 3 resueltos el 2026-08-04, sin esperar la ronda posterior
   porque no dependían de ninguna decisión externa (a diferencia de los 4 bloqueantes de arriba):
   - ~~Sin rate limiting en ningún endpoint~~ — **resuelto**: `requireDashboardAuth`
     (`src/dashboard/auth.ts`) ahora corta con `429` (header `Retry-After: 900`) a una IP que
     acumule 10 intentos fallidos en 15 minutos (`src/dashboard/rateLimit.ts`, en memoria, mismo
     patrón que el throttle de modo degradado — se resetea si el proceso reinicia, aceptado). Solo
     cuenta fallos, así que un uso normal con credenciales correctas nunca se ve afectado; una vez
     bloqueada la IP, ni siquiera la contraseña correcta pasa hasta que venza la ventana (verificado
     a mano: 9 fallos pasan, el 10mo ya da 429, y con la contraseña real después sigue dando 429).
     El webhook no necesitaba esto (ver nota original, sigue vigente). **Caveat documentado en el
     código**: usa `request.ip`, que sin `trustProxy` configurado en Fastify da la IP del proxy (no
     la del cliente real) si el hosting final pone un reverse proxy adelante — revisar `trustProxy`
     el día que eso pase, es parte del punto "HTTPS delante del server" de arriba.
   - ~~Sin headers de seguridad tipo helmet~~ — **resuelto, parcial a propósito**: hook `onSend`
     global en `src/server.ts` agrega `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY` y
     `Referrer-Policy: same-origin` (2026-08-06, antes `no-referrer` — ver bug real más abajo) a toda respuesta (dashboard, webhook, health — inofensivo en las
     dos últimas por ser APIs JSON). Sin dependencia nueva (no se sumó `helmet`, mismo criterio que
     `URLSearchParams` en vez de `@fastify/formbody`). **Sin CSP ni HSTS a propósito**: el dashboard
     tiene un `<style>` inline (`dashboard/render.ts`) que un CSP por defecto rompería, y HSTS no
     tiene sentido hasta que haya HTTPS real delante (bloqueante ya documentado arriba) — quedan
     pendientes de esa misma instancia, no de esta.
   - ~~CSRF en las acciones del dashboard~~ — **resuelto el 2026-08-04** (mismo día, pasada propia
     como se anotó acá mismo): `requireSameOrigin` (`src/dashboard/csrf.ts`), preHandler nuevo en
     los tres `POST /dashboard/...` (`pending/:id/resolve`, `pending/:id/reopen`,
     `conversations/:id/resolve`, antes de `requireDashboardAuth` — así una request cross-site ni
     gasta un intento contra el rate limit nuevo de arriba). Sin token (habría necesitado estado del
     lado servidor, que Basic Auth no tiene): compara el host de `Origin` (o `Referer` si el
     navegador no mandó `Origin`) contra el header `Host` del propio request — ninguno de los dos es
     falsificable por JS de otro origen. Falla cerrado sin ninguno de los dos headers, mismo criterio
     que `dashboard_not_configured` en `auth.ts`. Verificado a mano contra el servidor real: sin
     headers → `403`; `Origin: https://evil-site.com` → `403`; `Origin`/`Referer` apuntando al mismo
     host → `303` (el flujo normal del form). Sin tests de Vitest a propósito, mismo criterio que el
     resto de `dashboard/` (se verifica a mano, ver sección 2).
     **Bug real encontrado el 2026-08-06, usando el dashboard de verdad (no curl)**: "Marcar como
     atendido"/"Reactivar bot" tiraban `403` siempre, incluso haciendo click en la propia página. Causa:
     el header `Referrer-Policy: no-referrer` (ver `server.ts`, fila de arriba) le sacaba el `Referer`
     a la navegación del propio `<form>`, y el navegador tampoco manda `Origin` en esa request
     same-origin puntual — `requireSameOrigin` se quedaba sin nada que validar y fallaba cerrado contra
     un caso legítimo, no solo contra ataques. Las pruebas con curl de más arriba no lo agarraron
     porque ahí los headers se arman a mano (siempre presentes). **Fix**: `Referrer-Policy` pasó de
     `no-referrer` a `same-origin` — misma protección hacia sitios externos, pero deja pasar el
     `Referer` en navegación same-origin. Re-verificado con curl replicando el caso real (solo
     `Referer`, sin `Origin`) → `303`; cross-site y sin headers siguen en `403`. **Lección**: probar
     los forms del dashboard con curl armando los headers a mano no sustituye probarlos desde un
     navegador real — quedó un blind spot ahí.

8. **Activar WhatsApp Coexistence (2026-08-04, documentado, sin implementar a propósito — pedido
   explícito del usuario: no tocar código todavía, solo dejarlo anotado para retomar más adelante).**
   Hoy el botón "Abrir chat" del dashboard (`chatIdToWaLink` en `src/dashboard/render.ts`) rompe la
   continuidad de la conversación: abre el WhatsApp **personal** del vendedor (vía `wa.me/<número>`),
   no el hilo real que tuvo el bot con el cliente en el número de negocio — el vendedor termina
   escribiendo desde otro número, sin ver el historial. Coexistence (feature de Meta que permite usar
   la app/WhatsApp Web normal en el mismo número que corre la Cloud API) resolvería esto de raíz, y de
   paso cierra el gap ya documentado en la sección 5 ("Marcar como atendido"... pero el sistema sigue
   sin enterarse si el vendedor responde a mano).

   Implica, cuando se retome:
   - Suscribir el webhook al campo `message_echoes` (además de `messages`, que ya está suscripto) —
     es el evento que manda Meta cuando alguien responde desde la app/WhatsApp Web coexistiendo con la
     Cloud API, algo que hoy `parseWebhook` (`src/messaging/cloudApi/parseWebhook.ts`) no contempla en
     absoluto.
   - Decidir cómo tratar esos mensajes: **no deben pasar por el motor de decisión** (`engine/`) — un
     mensaje que el vendedor ya contestó a mano no necesita (ni debe) que el bot le responda encima —
     solo persistirse, probablemente marcando la conversación de alguna forma para que el bot se
     quede en silencio ahí (mecanismo a definir: ¿reusar `derivada`? ¿estado nuevo?).
   - Evaluar impacto en `getPendingReviewMessages`/`getConversationOutcomes` (`db/repositories/stats.ts`):
     si el vendedor ya respondió por Coexistence, ese mensaje debería dejar de contar como pendiente
     sin que nadie tenga que tocar "Marcar como atendido" a mano.

   **Importante**: si en algún momento el trabajo se acerca a `parseWebhook`, `webhook/routes.ts`,
   `messaging/types.ts`, o al botón "Abrir chat"/`chatIdToWaLink` de `dashboard/render.ts`, mencionarle
   al usuario que este pendiente existe y toca esa misma zona, antes de asumir que el cambio es
   aislado.

9. **Sacar la base de datos del archivo SQLite local y llevar el backup fuera de la máquina
   (2026-08-04, documentado, sin implementar a propósito — pedido explícito del usuario).** Motivado
   por la propia sesión de hoy: hubo que borrar y recrear `data/bot.db` a mano dos veces para limpiar
   datos de prueba (con backup previo, pero local) — un archivo único en un solo disco es un punto
   único de falla, y además cualquiera con acceso al filesystem (un agente, un script, un typo de
   `rm`) puede tocarlo directamente sin pasar por ninguna capa de control.
   - **Base de datos**: hoy `DATABASE_URL=file:./data/bot.db` (SQLite local vía `@libsql/client`, ver
     decisión en sección 2). Evaluar apuntar a un servicio gestionado en vez de un archivo local — la
     opción más directa es **Turso** (mismo `@libsql/client`, mismo dialecto en `drizzle.config.ts`,
     **no debería requerir cambiar código**, solo `DATABASE_URL` + un `authToken`), pero vale evaluar
     alternativas (Postgres gestionado, etc.) si en algún momento se necesita algo más que SQLite.
   - **Backups**: `scripts/backup-db.mjs` hoy copia a `backups/` **dentro del mismo proyecto/disco**
     (`path.join(path.dirname(dbPath), "..", "backups")` en el script) — sirve para deshacer un error
     propio al toque, pero no protege contra un problema de la máquina entera. Sumar un destino externo
     (subida a un storage tipo S3/Google Drive, o al menos otro disco/carpeta fuera del repo) además
     del local, no en reemplazo.
   - ~~Pendiente más chico de la Fase 3: agendar el script~~ — **resuelto el 2026-08-04** (ver
     sección 3, fila de `scripts/backup-db.mjs`): tarea diaria en el Programador de tareas de
     Windows de esta máquina. Sigue en pie el punto de fondo de esta sección 9 (destino externo,
     no solo el mismo disco).

## 7. Adaptaciones a CONSTITUTION.md

Ninguna. Las decisiones específicas del proyecto (SQLite vía libsql, TypeScript 6.x, etc.) son
elecciones técnicas dentro del margen que la Constitución deja abierto, no excepciones a sus
reglas.

## 8. Convenciones específicas de este proyecto

Hereda las convenciones generales de `CONSTITUTION.md` (variables en inglés, comentarios en
español, Conventional Commits, etc.). Adicional a esto:

- El motor de decisión (`src/engine/`, incluye `RulesEngine`, `AiEngine` y `HybridEngine`) no importa
  nada de `db/` ni `messaging/` (antes `waha/`), ni siquiera tipos — es una regla de diseño explícita
  (ver comentario en `src/engine/types.ts`) para que se pueda testear y recomponer sin arrastrar
  dependencias. Sí puede importar de `config/` (igual que `RulesEngine` desde la Fase 1): `AiEngine`
  lee `OPENAI_MODEL` de `config/env.ts`.
- Mismo principio de aislamiento se aplica a `src/messaging/` (Fase 5): el resto del sistema depende
  solo de la interfaz `MessagingProvider`, nunca de `CloudApiProvider` directamente — así se puede
  reemplazar el proveedor (como pasó con WAHA → Meta) sin tocar webhook/orquestador/dashboard/DB.
- Todo lo específico del negocio (FAQs, palabras de intención de compra, mensajes) vive en
  `src/config/`, nunca hardcodeado en `engine/` ni en `conversation/`.
