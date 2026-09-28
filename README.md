# Asistente de WhatsApp

Bot de atención al primer contacto por WhatsApp: responde preguntas frecuentes automáticamente,
detecta intención de compra y deriva la conversación a un vendedor humano cuando corresponde.

Producto pensado para escalar en fases (ver `CLAUDE.md` para el detalle completo). Estado actual:

- **Fase 1** (motor de reglas, sin IA), **Fase 2** (multi-canal) y **Fase 3** (dashboard +
  confiabilidad) completas — ver [más abajo](#fase-3--dashboard-y-confiabilidad).
- Fase 4 (IA vía Vercel AI SDK) implementada, apagada por defecto.
- **Fase 5** (Cloud API oficial de Meta como único proveedor de mensajería) completa — ver
  [más abajo](#fase-5--cloud-api-de-meta).

## Descripción

El flujo es: Meta recibe el mensaje de WhatsApp → lo reenvía a este servidor por webhook → el
motor de reglas (`src/engine/`) decide una respuesta → el bot responde vía la Cloud API y guarda
todo en SQLite. Si detecta intención de compra, marca la conversación como derivada y deja de
autoresponder (un vendedor humano toma la posta, o la reactiva desde el dashboard — ver
[Fase 3](#fase-3--dashboard-y-confiabilidad)).

## Instalación

Requiere Node.js 20+ y una app de Meta con el producto WhatsApp habilitado (gratis, con un número
de prueba — [Meta App Dashboard](https://developers.facebook.com/apps)). No hace falta tenerla
lista para empezar: todo el flujo se puede probar en modo dry-run sin credenciales reales (ver
paso 3 de "Cómo ejecutar").

```bash
npm install
cp .env.example .env    # placeholders alcanzan para dry-run; ver "Variables de entorno"
npm run db:migrate
```

> Antes de exponer esto en producción (`NODE_ENV=production`): `META_APP_SECRET` y
> `META_VERIFY_TOKEN` pasan a ser obligatorios (el server no arranca sin ellos), y hay que reemplazar
> los placeholders de `DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD` por valores propios — el server
> tampoco arranca si el usuario sigue siendo `admin` o la password tiene menos de 12 caracteres.

## Variables de entorno

Ver `.env.example` para la lista completa con comentarios. Las más importantes:

| Variable | Descripción | Default |
|---|---|---|
| `PORT` | Puerto donde escucha este servidor | `3001` |
| `DATABASE_URL` | Archivo SQLite local (vía libsql) | `file:./data/bot.db` |
| `META_GRAPH_API_VERSION` | Versión de la Graph API de Meta | `v21.0` |
| `META_PHONE_NUMBER_ID` | Id del número de WhatsApp Business (**requerido**, App Dashboard > WhatsApp > API Setup) | — |
| `META_ACCESS_TOKEN` | Token de acceso (**requerido**; temporal en dev, permanente vía System User en producción) | — |
| `META_APP_SECRET` | App Secret de tu app de Meta. Verifica la firma `X-Hub-Signature-256`. Opcional en `development`/`test`, **obligatoria si `NODE_ENV=production`** (el server no arranca sin ella) | (sin verificar) |
| `META_VERIFY_TOKEN` | Token elegido por vos, cargado también en el App Dashboard, para el `GET` de verificación del webhook. Mismo criterio que `META_APP_SECRET` | (sin configurar) |
| `META_DRY_RUN` | Si es `true`, no envía mensajes reales: solo loguea | `false` |
| `RESPONSE_DELAY_MIN_MS` / `MAX_MS` | Delay aleatorio antes de responder. La API oficial no tiene riesgo de ban por comportamiento, así que el default es 0 (respuesta instantánea) | `0` / `0` |
| `QUEUE_CONCURRENCY` | Cuántas conversaciones **distintas** se procesan en paralelo ante un pico de tráfico. Dentro de una misma conversación siempre es 1 mensaje a la vez, sea cual sea este valor | `10` |
| `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` | Credenciales de `/dashboard` (Basic Auth). Sin password, el dashboard no se monta. **Con `NODE_ENV=production`, el usuario no puede seguir siendo `admin` y la password necesita 12+ caracteres** (el server no arranca si no) | (placeholders en `.env.example`, a cambiar) |
| `AI_FALLBACK_ENABLED` | Si es `true`, la IA responde las preguntas que el motor de reglas no matcheó (Fase 4) | `false` |
| `OPENAI_API_KEY` | API key de OpenAI (**requerida si `AI_FALLBACK_ENABLED=true`**) | — |
| `OPENAI_MODEL` | Modelo de OpenAI a usar | `gpt-4o-mini` |

Si agregás una variable nueva, actualizá `.env.example`, `src/config/env.ts` (schema de Zod) y
esta tabla.

## Cómo ejecutar

### 1. Correr el bot

```bash
npm run dev
```

Arranca en `http://localhost:3001` (o el `PORT` que hayas configurado). Al arrancar sincroniza el
catálogo de categorías en la base y expone `GET /health`. No hace falta tener credenciales reales
de Meta para este paso — con los placeholders de `.env.example` y `META_DRY_RUN=true` alcanza.

### 2. Probar sin cuenta de Meta (recomendado para empezar)

Con `META_DRY_RUN=true` en tu `.env` (default), el bot no manda mensajes reales — solo loguea qué
hubiera respondido. Podés probar todo el flujo (parseo → motor de reglas → persistencia) sin
credenciales de Meta:

```bash
npm run simulate -- "¿cuál es el horario?"
npm run simulate -- "quiero comprar" --chat-id 5492222222222 --channel-id 999999999999
npm run simulate -- "hola" --chats 20 --count 2   # 40 mensajes, 20 conversaciones, un solo POST
```

Mirá la consola de `npm run dev`: vas a ver la línea `[cloud-api dry-run] ...` con la respuesta que
se hubiera enviado, y (si aplica) el stub de `notifyVendor`. Más opciones del script (acuses de
estado, prueba de idempotencia, verificación del webhook) en el comentario de cabecera de
`scripts/simulate-message.mjs`.

Para inspeccionar la base de datos con una UI:

```bash
npm run db:studio
```

### 3. Conectar una cuenta real de Meta

1. Creá una app en el [Meta App Dashboard](https://developers.facebook.com/apps), agregá el
   producto **WhatsApp** — te da un número de prueba gratis con sandbox completo, no hace falta un
   chip real para empezar.
2. Cargá en `.env`: `META_PHONE_NUMBER_ID` y `META_ACCESS_TOKEN` (App Dashboard > WhatsApp >
   API Setup), `META_APP_SECRET` (App Settings > Basic), y elegí vos un `META_VERIFY_TOKEN`
   (cualquier string).
3. Exponé tu servidor local con HTTPS público — Meta no acepta `localhost` para el webhook, ni
   siquiera en desarrollo:
   ```bash
   npx cloudflared tunnel --url http://localhost:3001    # o ngrok http 3001
   ```
4. En el App Dashboard, WhatsApp > Configuration > Webhook: cargá la Callback URL
   (`https://<tu-túnel>/webhook/whatsapp`) y el mismo `META_VERIFY_TOKEN` que pusiste en `.env`.
   Meta va a hacer un `GET` de verificación — si el servidor está corriendo, se resuelve solo.
   Suscribite al campo `messages`.
5. Poné `META_DRY_RUN=false` en `.env` y reiniciá el servidor. Mandale un WhatsApp al número de
   prueba desde otro teléfono — deberías ver la respuesta llegar con tilde azul (mark-read) y
   "escribiendo…" durante el delay configurado.

> **El token temporal del App Dashboard vence a las ~24hs.** Para dejarlo corriendo sin
> reconfigurar todos los días, generá un token permanente de System User (App Dashboard >
> Business Settings > System Users).

## Cargar tus propias FAQs

Todo lo específico del negocio vive en `src/config/`, nunca hardcodeado en la lógica:

- **`src/config/rules.ts`** — FAQs: cada entrada tiene `category`, `categoryLabel`, `keywords`
  (frases que activan la regla) y `responses` (array de variantes). La primera regla que matchea
  gana; la respuesta se elige al azar entre las variantes (ver "Comportamiento de respuesta" más
  abajo).
- **`src/config/purchaseIntent.ts`** — palabras/frases que se interpretan como intención de
  compra (derivan la conversación a un vendedor).
- **`src/config/messages.ts`** — variantes del mensaje genérico de fallback y del mensaje de
  derivación.
- **`src/config/categories.ts`** — se arma solo a partir de los dos archivos anteriores; no hace
  falta tocarlo salvo que agregues una categoría fuera de una FAQ o de intención de compra.

El texto se normaliza (minúsculas, sin tildes, sin puntuación) antes de matchear, y las frases se
comparan por secuencia de palabras completas — así `"precio"` no matchea dentro de `"precioso"`.

Después de editar las reglas, no hace falta migrar nada: el catálogo de categorías se sincroniza
solo en cada arranque del servidor.

Si `AI_FALLBACK_ENABLED=true` (Fase 4), estas mismas FAQs son también el único contexto que recibe
la IA — no hace falta mantener un contenido separado para el fallback con LLM.

## Comportamiento de respuesta

Con la Cloud API oficial de Meta no hay riesgo de ban por comportamiento — estas señales se
mantienen como decisión de UX, para que las respuestas no se sientan robóticas:

- **Delay antes de responder** (`RESPONSE_DELAY_MIN_MS`/`RESPONSE_DELAY_MAX_MS` en `.env`, `0` por
  defecto — respuesta instantánea). Subilo si preferís que se sienta menos robótico.
- **Indicador de "escribiendo…"** durante ese delay (`messaging.markReadAndTyping` en
  `src/messaging/cloudApi/`), junto con el marcado de "leído" (tilde azul) del mensaje del
  cliente. Es cosmético: si falla, no bloquea el envío del mensaje real.
- **Variantes de respuesta**: cada FAQ y los mensajes de fallback/derivación tienen más de un texto
  posible (`src/config/rules.ts`, `src/config/messages.ts`), elegido al azar en cada respuesta
  (`src/engine/variant.ts`), para no repetir siempre el mismo mensaje exacto ante usuarios
  distintos.

## Cola de procesamiento y picos de tráfico

Los mensajes entrantes se procesan por una cola en memoria (`src/queue/messageQueue.ts`, `p-queue`)
para que el webhook responda 200 de inmediato y Meta no lo reintente por timeout. `QUEUE_CONCURRENCY` (default
`10`) controla cuántas **conversaciones distintas** se procesan en paralelo ante un pico.

Dentro de una misma conversación, los mensajes siempre se procesan de a uno y en el orden en que
llegaron, sea cual sea `QUEUE_CONCURRENCY` — necesario para no pisarse el estado si el mismo cliente
manda dos mensajes casi juntos (ej. evitar derivar dos veces la misma conversación, o responder
fuera de orden). Se logra encadenando las tareas de cada conversación entre sí antes de que entren a
la cola global; conversaciones distintas sí compiten libremente por los `QUEUE_CONCURRENCY` slots
disponibles.

## Fase 2 — varios números

Soportar varios números de WhatsApp Business (por ejemplo uno para "ventas" y otro para "soporte")
no requiere tocar código. El modelo de datos ya se diseñó pensando en esto desde la Fase 1:

- El webhook (`src/webhook/routes.ts`) toma el `channelId` de `metadata.phone_number_id`, el campo
  que manda Meta en cada mensaje — nunca está hardcodeado.
- El cliente de mensajería (`src/messaging/cloudApi/`) recibe `channelId` como parámetro en cada
  envío, así que responde por el mismo número del que vino el mensaje.
- El modelo de datos (`conversations` en `src/db/schema.ts`) identifica cada conversación por la
  clave `(channelId, chatId)`, no solo por `chatId`.

Como consecuencia, si el mismo cliente le escribe al número de "ventas" y al de "soporte", se
generan dos conversaciones completamente independientes — cada una con su propio estado, sus
propias respuestas y su propia posible derivación a un vendedor.

Varios números de WhatsApp Business bajo la misma app de Meta comparten **un solo webhook y un solo
token de acceso** — agregar un número es solo agregarlo del lado del App Dashboard, sin tocar
`.env` ni reiniciar el servidor (el `channelId` llega en cada mensaje, no hace falta configurarlo de
antemano).

Para que el dashboard muestre un nombre legible en vez del `phone_number_id` crudo, agregalo a
`CHANNEL_LABELS` en `src/config/channels.ts`:

```ts
export const CHANNEL_LABELS: Record<string, string> = {
  "123456789012345": "Ventas",
  "987654321098765": "Soporte",
};
```

## Fase 3 — dashboard y confiabilidad

### Dashboard

`GET /dashboard` muestra, en una página HTML server-rendered (sin frontend aparte, sin JS de
cliente):

La página tiene dos zonas, separadas por una línea, pensadas para dos lectores distintos:

**Arriba — lo que necesita quien está respondiendo el día a día. Siempre el estado completo y
actual, sin filtro de fecha:**

- Cards de resumen: **Conversaciones**, **Pendientes por responder**, **Resueltas manualmente**
  (totales de siempre, no del período que se esté mirando en Detalle).
- **Pendientes de revisión, uno por uno**: no solo el número, sino el mensaje real del cliente, cuándo
  llegó, hace cuánto (antigüedad), el canal, la categoría, un link "Abrir chat" a `wa.me/<número>` y
  un botón **"Marcar como atendido"** que la saca de la lista y queda registrada con fecha de
  resolución (`reviewed_at` en `messages`; acción simple sin JS, un `<form>` que hace POST y redirige
  de vuelta preservando el filtro de fecha que tenga puesto Detalle — **no se puede deshacer**, pero
  se puede corregir desde "Resueltas recientemente" más abajo). Junta los dos motivos por los que
  algo puede necesitar seguimiento —derivación por intención de compra (lead esperando que lo
  contacten) y fallback genérico (el bot no supo responder)—, distinguibles por la columna de
  categoría. Del más viejo al más nuevo, para que nada se pierda. **Esta cola nunca se filtra por
  fecha**, a propósito: es justo lo que alguien necesita ver íntegro para no perder de vista un
  pendiente por un filtro que se olvidó de sacar. Las filas de una conversación **derivada** además
  tienen un botón **"Reactivar bot"**: la vuelve a poner `activa` para que el bot le vuelva a
  responder ahí (sin pisar el registro de cuándo se derivó).
- **"Resueltas recientemente"** (colapsado): las últimas 20 marcadas como atendidas, con un botón
  **"Reabrir"** por si alguien se apretó — no es el historial completo, para eso está "Resultados"
  en Detalle.

**Abajo, bajo "Detalle" — análisis para el dueño del negocio, con su propio filtro de fecha
(`Desde`/`Hasta`, en `?from=`/`?to=`) que solo afecta a esta sección:**

- Conversaciones **resueltas por el bot** vs. **derivadas a un vendedor** vs. **sin resolver por el
  bot** — con porcentaje de cada una.
- Respuestas agrupadas por categoría (FAQ que matcheó).
- Tiempo de respuesta promedio al cliente.
- Volumen por canal (útil cuando hay más de un número, ver Fase 2).

> **"Resueltas por el bot" excluye los fallbacks a propósito.** Una conversación donde el bot solo
> contestó el mensaje genérico ("no entendí tu consulta") no está resuelta — quedó esperando que la
> mire una persona. Por eso existe la columna "sin resolver por el bot" en vez de mezclarla con las
> resueltas.
>
> **Ojo con comparar "Pendientes por responder" contra "Derivadas" + "sin resolver por el bot":**
> el primero cuenta **mensajes**, los otros dos cuentan **conversaciones**. Si una misma conversación
> acumuló más de un mensaje pendiente (ej. una consulta sin responder y después una derivación), va a
> sumar una sola vez en "Derivadas"/"sin resolver" pero varias en "Pendientes por responder" — no es
> un bug, son dos unidades de medida distintas a propósito (una para saber cuánto trabajo por hacer
> hay, otra para saber cuántos clientes están en cada situación).

Protegido con **HTTP Basic Auth** (`DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD` en `.env`): el
navegador va a pedir usuario y contraseña la primera vez. Si `DASHBOARD_PASSWORD` no está seteada,
la ruta directamente no existe (404) — nunca se sirve un dashboard sin proteger, y su ausencia
nunca impide que el bot funcione.

```
http://localhost:3001/dashboard                          # todo el historial
http://localhost:3001/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD   # filtrado por fecha
```

> En producción, poné esto detrás de un reverse proxy con TLS — Basic Auth manda las credenciales
> sin cifrar en cada request si no hay HTTPS. Además, con `NODE_ENV=production` el server no arranca
> si `DASHBOARD_USERNAME` sigue siendo `admin` o si `DASHBOARD_PASSWORD` tiene menos de 12
> caracteres — cambiá los placeholders de `.env.example` por valores propios antes de desplegar.

### Modo degradado

Si algo interno falla al procesar un mensaje (el motor, la base de datos, lo que sea),
`src/conversation/handleIncomingMessage.ts` no deja al cliente en silencio: intenta mandar un
mensaje de resguardo fijo ("Recibimos tu consulta, en breve te contactamos...") y lo persiste con
categoría `error_interno` y `needsHumanReview: true`, para que aparezca en el dashboard.

Tiene un throttle en memoria (`src/conversation/degradedMode.ts`, ventana de 5 min por chat): si la
falla se repite en varios mensajes seguidos del mismo cliente, solo se manda **una** respuesta de
resguardo, no una por mensaje — mandar el mismo texto diez veces seguidas sería la señal de
automatización más obvia que existe.

### Healthcheck real

`GET /health` (sin autenticación, para que un monitor externo tipo UptimeRobot pueda pegarle)
verifica que la base de datos responda de verdad, no solo que el proceso esté vivo. Si la base no
responde, devuelve `503`.

### Mantener el proceso corriendo (PM2)

```bash
npm run build
npx pm2 start ecosystem.config.cjs
npx pm2 startup   # deja PM2 arrancando solo cuando reinicia el servidor (seguí las instrucciones que imprime)
npx pm2 save      # persiste la lista de procesos actual
npx pm2 logs whatsapp-bot
```

Si el proceso se cae, PM2 lo reinicia automáticamente (`autorestart: true` en
`ecosystem.config.cjs`). En Linux, la alternativa es un unit de **systemd** apuntando a
`node --env-file=.env dist/server.js` con `Restart=always`; PM2 es la opción documentada acá por
ser multiplataforma y no requerir privilegios de sistema para instalarse.

## Fase 4 — IA como fallback (OpenAI vía Vercel AI SDK)

El motor de reglas (`RulesEngine`) sigue siendo la primera línea de decisión: intención de compra
y FAQs con match exacto por keywords se resuelven igual que en la Fase 1, sin llamar a ningún LLM.
La IA (`AiEngine`) solo entra cuando `RulesEngine` no matchea nada — en vez de ir directo al
mensaje genérico fijo, intenta responder usando **exclusivamente** las FAQs configuradas en
`src/config/rules.ts` (mismo texto de ejemplo, mismo tono). Si no puede responder con eso, cae al
mismo mensaje de fallback fijo que usaría el motor de reglas (`requiereRevisionHumana: true`) — el
LLM nunca redacta el texto de resguardo ni inventa datos del negocio (precios, horarios, stock)
que no estén en las FAQs.

Esta composición vive en `src/engine/hybridEngine.ts`; `src/engine/index.ts` sigue siendo el único
punto de selección del motor, tal como preveía la interfaz `ResponseEngine` desde la Fase 1.

- **Apagado por defecto** (`AI_FALLBACK_ENABLED=false`): sin esto, el comportamiento es idéntico a
  la Fase 1, sin costo ni dependencia de OpenAI. Prender con `AI_FALLBACK_ENABLED=true` y
  `OPENAI_API_KEY` en `.env` — si falta la key con el flag prendido, el servidor no arranca (falla
  rápido, mismo criterio que el resto de `src/config/env.ts`).
- **Costo por request**: cada pregunta que no matchea ninguna regla dispara una llamada real a la
  API de OpenAI. Antes de prender esto en un negocio con volumen real, mirar el pricing vigente del
  modelo elegido (`OPENAI_MODEL`, default `gpt-4o-mini`) y ajustarlo si hace falta.
- **Timeout de 15s** y errores tipados (`AiEngineError`), mismo patrón que `MessagingError` en
  `src/messaging/`. Si OpenAI
  falla o tarda de más, el error sube sin capturarse hasta `handleIncomingMessage`, que lo trata
  como cualquier otro fallo no controlado: cae al **modo degradado** de la Fase 3 (mensaje de
  resguardo + throttle), no deja al cliente en silencio.
- La intención de compra sigue siendo una decisión estructurada de `RulesEngine` por keywords, no
  algo que decide el LLM — `AiEngine` nunca devuelve `esIntencionCompra: true`.
- Para probar sin gastar: dejar `AI_FALLBACK_ENABLED=false` (default) y usar `npm run simulate` con
  mensajes que sí matcheen alguna FAQ, o revisar `tests/engine/aiEngine.test.ts` /
  `hybridEngine.test.ts`, que mockean la llamada a OpenAI.

## Fase 5 — Cloud API de Meta

**Completa.** La Cloud API oficial de Meta (`src/messaging/cloudApi/`) es el único proveedor de
mensajería del bot, detrás de la interfaz `MessagingProvider` — el resto del sistema (motor de
decisión, base de datos, cola, dashboard) no depende de Meta directamente.

Esto ya se explica en detalle en otras secciones de este README, no se repite acá:

- Cómo conectar una cuenta real y sus restricciones (ventana de 24hs, token temporal vs.
  permanente, webhook público por HTTPS) — ver ["Cómo ejecutar", paso 3](#3-conectar-una-cuenta-real-de-meta).
- Delay configurable, indicador de "escribiendo…" y variantes de respuesta — ver
  [Comportamiento de respuesta](#comportamiento-de-respuesta).
- Módulos y tests involucrados — ver [Estructura](#estructura) y [Testing](#testing).

## Estructura

```
src/
  server.ts          Arranque de Fastify: rutas, seed de categorías, shutdown ordenado
  config/             Todo lo específico del negocio (FAQs, intención de compra, env)
  db/                 Schema de Drizzle, cliente, migraciones, repositorios, healthcheck
    repositories/stats.ts  Agregaciones del dashboard (Fase 3)
  engine/             Motor de decisión (ResponseEngine): RulesEngine (Fase 1), AiEngine y
                       HybridEngine (Fase 4, fallback con IA solo si AI_FALLBACK_ENABLED=true)
  messaging/          Proveedor de mensajería (MessagingProvider, Fase 5): CloudApiProvider
                       (Meta) detrás de la interfaz — sendText, markReadAndTyping,
                       verifyWebhookSignature, parseWebhook (puro, nunca tira)
  webhook/             Endpoint que recibe eventos de Meta (verifica firma, filtra, encola)
  queue/              Cola de procesamiento en memoria (p-queue, concurrencia configurable
                       vía QUEUE_CONCURRENCY; 1 mensaje a la vez por conversación siempre)
  conversation/       Orquestador: decide, deriva, envía y persiste; modo degradado (Fase 3)
  dashboard/          Vista HTML de /dashboard, su auth (Fase 3)
tests/
  engine/             Tests de Vitest del motor de reglas (normalización, matching, decisiones)
  messaging/          Tests de parseWebhook (Cloud API) y verifyMetaSignature (Fase 5) — puros,
                       nunca pegan a la red
scripts/
  simulate-message.mjs  Dispara un webhook simulado de Meta contra el servidor local
ecosystem.config.cjs  Config de PM2 para producción (Fase 3)
```

## Dependencias

| Paquete | Para qué |
|---|---|
| `fastify` | Servidor HTTP del webhook y `/health` |
| `drizzle-orm` + `@libsql/client` | ORM y driver de SQLite (archivo local, sin compilación nativa) |
| `drizzle-kit` (dev) | Generación y aplicación de migraciones |
| `zod` | Validación de variables de entorno y de los payloads de la Cloud API de Meta |
| `p-queue` | Cola de procesamiento en memoria para no bloquear el webhook |
| `pino-pretty` | Logs legibles en desarrollo (Fastify usa pino) |
| `ai` + `@ai-sdk/openai` | Fallback con IA de la Fase 4 (`AiEngine`), solo activo si `AI_FALLBACK_ENABLED=true` |
| `vitest` (dev) | Tests del motor de reglas y de IA |
| `tsx` (dev) | Ejecutar TypeScript directo en desarrollo, sin paso de build |

No se agregó ninguna dependencia para lo que Node ya resuelve nativo (`fetch`, `crypto` para el
HMAC, etc.).

## Cómo hacer deploy

Ver Fase 3 del roadmap para lo ya resuelto (PM2/systemd, auto-restart, healthcheck externo). Para
un ambiente productivo mínimo:

```bash
npm run build       # compila a dist/
npm run db:migrate  # aplica migraciones contra el DATABASE_URL de destino
npm start            # corre dist/server.js
```

El hosting elegido tiene que exponer el servidor por **HTTPS público** — Meta exige un endpoint
alcanzable con certificado válido para el webhook, incluso para probar. Cargá la Callback URL real
(`https://tu-dominio/webhook/whatsapp`) en el App Dashboard y usá un `META_ACCESS_TOKEN` permanente
de System User, no el temporal de desarrollo (ver "Cómo ejecutar", paso 3).

## Backups

Toda la base es un solo archivo SQLite (`DATABASE_URL`, `file:./data/bot.db` por defecto) sin
ninguna estrategia de respaldo automática — perder ese archivo es perder todo el historial de
conversaciones.

```bash
npm run db:backup                # copia a backups/bot-<fecha>-<hora>.db, retiene las últimas 30
npm run db:backup -- --keep 7    # retiene las últimas 7 en vez de 30
```

Para que corra solo, agregalo a un cron (Linux) o al Programador de tareas (Windows) apuntando a
`node --env-file=.env scripts/backup-db.mjs` con la frecuencia que necesites (ej. diario). El script
no hace nada si `DATABASE_URL` no es un archivo local — no aplica a otro tipo de conexión.
`backups/` ya está cubierto por `.gitignore` (mismo patrón `*.db` que la base real): no lo subas al
repo, y considerá copiar esos archivos a almacenamiento externo (no solo al mismo disco).

## Testing

```bash
npm test          # corre una vez
npm run test:watch  # modo watch
```

Los tests cubren el motor de decisión completo (`src/engine/`): normalización de texto, matching
por tokens, las decisiones de `RulesEngine` (FAQ, intención de compra, prioridad entre ambas,
fallback), `AiEngine` (con la llamada a OpenAI mockeada — los tests nunca pegan a la API real) y
`HybridEngine` (que las reglas ganen siempre que matcheen, que la IA sea el fallback y no al revés).
Es lógica pura sin dependencias externas de infraestructura — la elegimos como foco de testing
automático porque es la pieza que reemplazó/extendió la Fase 4.

Desde la Fase 5 también cubren `src/messaging/cloudApi/`: `parseWebhook` (lotes de mensajes,
mensajes + acuses de estado mezclados, tipos no soportados, payloads malformados que no deben tirar
ni tumbar el resto del lote) y `verifyMetaSignature` (firma válida/inválida/corrompida, sin secret
configurado). Misma razón — son puros y deterministas, sin red ni base de datos de por medio.

El resto del flujo (webhook, orquestador, repositorios) se verifica manualmente con
`npm run simulate` en modo dry-run, como se explica arriba.
