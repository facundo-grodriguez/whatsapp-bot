# Asistente de WhatsApp

Bot de atención al primer contacto por WhatsApp: responde preguntas frecuentes automáticamente,
detecta intención de compra y deriva la conversación a un vendedor humano cuando corresponde.

Producto pensado para escalar en 4 fases (ver `CLAUDE.md` para el detalle completo). Estado actual:

- **Fase 1** (motor de reglas, sin IA) y **Fase 2** (multi-sesión) completas.
- **Fase 3** (dashboard + confiabilidad) completa — ver [más abajo](#fase-3--dashboard-y-confiabilidad).
- Fase 4 (IA vía Vercel AI SDK) pendiente.
- Conexión a WhatsApp vía [WAHA](https://github.com/devlikeapro/waha) (self-hosted, Docker).

## Descripción

El flujo es: WAHA recibe el mensaje de WhatsApp → lo reenvía a este servidor por webhook → el
motor de reglas (`src/engine/`) decide una respuesta → el bot responde por WAHA y guarda todo en
SQLite. Si detecta intención de compra, marca la conversación como derivada y deja de
autoresponder (un vendedor humano toma la posta).

## Instalación

Requiere Node.js 20+ y Docker (para WAHA).

```bash
npm install
cp .env.example .env    # completar WAHA_API_KEY como mínimo
npm run db:migrate
```

## Variables de entorno

Ver `.env.example` para la lista completa con comentarios. Las más importantes:

| Variable | Descripción | Default |
|---|---|---|
| `PORT` | Puerto donde escucha este servidor | `3001` |
| `DATABASE_URL` | Archivo SQLite local (vía libsql) | `file:./data/bot.db` |
| `WAHA_BASE_URL` | URL de tu contenedor de WAHA | `http://localhost:3000` |
| `WAHA_API_KEY` | API key configurada en WAHA (**requerida**) | — |
| `WAHA_HMAC_KEY` | Clave para verificar la firma de los webhooks | (sin verificar) |
| `WAHA_DRY_RUN` | Si es `true`, no envía mensajes reales: solo loguea | `false` |
| `RESPONSE_DELAY_MIN_MS` / `MAX_MS` | Delay aleatorio antes de responder (simula tipeo humano) | `1000` / `3000` |
| `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` | Credenciales de `/dashboard` (Basic Auth). Sin password, el dashboard no se monta | `admin` / (sin dashboard) |

Si agregás una variable nueva, actualizá `.env.example`, `src/config/env.ts` (schema de Zod) y
esta tabla.

## Cómo ejecutar

### 1. Levantar WAHA (Docker)

```bash
docker run -it --rm -p 3000:3000 --name waha devlikeapro/waha
```

Esto deja WAHA corriendo en `http://localhost:3000` con la sesión `default` sin iniciar. Para un
setup persistente (no `--rm`) o con auth propia, ver la
[documentación de instalación de WAHA](https://waha.devlike.pro/docs/how-to/install/).

### 2. Correr el bot

```bash
npm run dev
```

Arranca en `http://localhost:3001` (o el `PORT` que hayas configurado). Al arrancar sincroniza el
catálogo de categorías en la base y expone `GET /health`.

### 3. Probar sin conectar un número real (recomendado para empezar)

Con `WAHA_DRY_RUN=true` en tu `.env`, el bot no manda mensajes reales — solo loguea qué hubiera
respondido. Podés probar todo el flujo (motor de reglas → persistencia) sin WAHA conectado a un
número:

```bash
npm run simulate -- "¿cuál es el horario?"
npm run simulate -- "quiero comprar" --chat-id 5492222222222@c.us --session ventas
```

Mirá la consola de `npm run dev`: vas a ver la línea `[WAHA dry-run] ...` con la respuesta que se
hubiera enviado, y (si aplica) el stub de `notifyVendor`.

Para inspeccionar la base de datos con una UI:

```bash
npm run db:studio
```

### 4. Conectar un número real de WhatsApp

Con WAHA corriendo, poné `WAHA_DRY_RUN=false` y configurá el webhook para que apunte a este
servidor:

```bash
curl -X POST http://localhost:3000/api/sessions \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: <tu WAHA_API_KEY>" \
  -d '{
    "name": "default",
    "config": {
      "webhooks": [{ "url": "http://host.docker.internal:3001/webhook/waha", "events": ["message"] }]
    }
  }'
```

> **Importante (Windows/Mac):** WAHA corre en un contenedor Docker, así que `localhost:3001` **no**
> es alcanzable desde adentro del contenedor — hay que usar `host.docker.internal` en la URL del
> webhook, como en el ejemplo. Es el error más común al conectar WAHA con un servidor local.

Después escaneá el QR (`GET /api/{session}/auth/qr` o el panel de WAHA en `http://localhost:3000`)
con el WhatsApp que quieras conectar, y mandale un mensaje desde otro teléfono.

## Cargar tus propias FAQs

Todo lo específico del negocio vive en `src/config/`, nunca hardcodeado en la lógica:

- **`src/config/rules.ts`** — FAQs: cada entrada tiene `category`, `categoryLabel`, `keywords`
  (frases que activan la regla) y `responses` (array de variantes). La primera regla que matchea
  gana; la respuesta se elige al azar entre las variantes (ver "Anti-ban" más abajo).
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

## Anti-ban (mitigar el riesgo de WAHA)

WAHA se conecta por un protocolo no oficial (ver riesgo documentado en CLAUDE.md), así que el bot
suma algunas señales para no comportarse como un bot obvio. No elimina el riesgo, lo reduce:

- **Delay aleatorio antes de responder** (`RESPONSE_DELAY_MIN_MS`/`RESPONSE_DELAY_MAX_MS` en
  `.env`, 1-3s por defecto).
- **Indicador de "escribiendo…"** durante ese delay (`startTyping`/`stopTyping` en
  `src/waha/client.ts`), si la instancia de WAHA lo soporta. Es cosmético: si falla, no bloquea el
  envío del mensaje real.
- **Variantes de respuesta**: cada FAQ y los mensajes de fallback/derivación tienen más de un texto
  posible (`src/config/rules.ts`, `src/config/messages.ts`), elegido al azar en cada respuesta
  (`src/engine/variant.ts`), para no repetir siempre el mismo mensaje exacto ante usuarios
  distintos.

Fuera del código: usar un número con SIM real (no VoIP) y con historial de uso normal, y responder
solo a mensajes entrantes (nunca broadcast/outbound) son los factores que más pesan — más que
cualquiera de los puntos anteriores.

## Fase 2 — multi-sesión

Soportar varios números de WhatsApp (por ejemplo uno para "ventas" y otro para "soporte", o uno
por cliente) es cuestión de dar de alta sesiones adicionales en WAHA — **no hace falta tocar
código**. El motor de reglas de la Fase 1 ya se diseñó pensando en esto:

- El webhook (`src/webhook/routes.ts`) lee el nombre de la sesión desde `event.session`, el campo
  que manda WAHA en cada evento — nunca está hardcodeado a `"default"`.
- El cliente de WAHA (`src/waha/client.ts`) recibe `session` como parámetro en cada envío, así que
  responde por la misma sesión de la que vino el mensaje.
- El modelo de datos (`conversations` en `src/db/schema.ts`) identifica cada conversación por la
  clave `(sessionName, chatId)`, no solo por `chatId`.

Como consecuencia, si el mismo cliente le escribe al número de "ventas" y al de "soporte", se
generan dos conversaciones completamente independientes — cada una con su propio estado, sus
propias respuestas y su propia posible derivación a un vendedor.

Para dar de alta una segunda sesión, repetí el paso 4 de "Cómo ejecutar" (
[Conectar un número real de WhatsApp](#4-conectar-un-número-real-de-whatsapp)) cambiando el `name`,
apuntando al **mismo** webhook:

```bash
curl -X POST http://localhost:3000/api/sessions \
  -H "Content-Type: application/json" \
  -H "X-Api-Key: <tu WAHA_API_KEY>" \
  -d '{
    "name": "soporte",
    "config": {
      "webhooks": [{ "url": "http://host.docker.internal:3001/webhook/waha", "events": ["message"] }]
    }
  }'
```

Escaneá el QR de esta sesión nueva (`GET /api/soporte/auth/qr`) con el número de WhatsApp que
corresponda — distinto al de la sesión `default` — y listo: el bot ya responde por ambos números
en paralelo, sin reiniciar ni redeployar nada.

> La misma nota sobre `host.docker.internal` en Windows/Mac de la sección 4 aplica acá: el webhook
> de cualquier sesión nueva tiene que apuntar a esa URL, no a `localhost`.

## Fase 3 — dashboard y confiabilidad

### Dashboard

`GET /dashboard` muestra, en una página HTML server-rendered (sin frontend aparte, sin JS de
cliente):

- Conversaciones **resueltas por el bot** vs. **derivadas a un vendedor** vs. **necesitan un
  humano** — con porcentaje de cada una.
- Respuestas agrupadas por categoría (FAQ que matcheó).
- Mensajes pendientes de revisión humana.
- Tiempo de respuesta promedio al cliente.
- Volumen por sesión (útil cuando hay más de un número, ver Fase 2).

> **"Resueltas por el bot" excluye los fallbacks a propósito.** Una conversación donde el bot solo
> contestó el mensaje genérico ("no entendí tu consulta") no está resuelta — quedó esperando que la
> mire una persona. Por eso existe la columna "necesitan un humano" en vez de mezclarla con las
> resueltas.

Protegido con **HTTP Basic Auth** (`DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD` en `.env`): el
navegador va a pedir usuario y contraseña la primera vez. Si `DASHBOARD_PASSWORD` no está seteada,
la ruta directamente no existe (404) — nunca se sirve un dashboard sin proteger, y su ausencia
nunca impide que el bot funcione.

```
http://localhost:3001/dashboard                          # todo el historial
http://localhost:3001/dashboard?from=2026-08-01&to=2026-08-31   # filtrado por fecha
```

> En producción, poné esto detrás de un reverse proxy con TLS — Basic Auth manda las credenciales
> sin cifrar en cada request si no hay HTTPS.

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

## Estructura

```
src/
  server.ts          Arranque de Fastify: rutas, seed de categorías, shutdown ordenado
  config/             Todo lo específico del negocio (FAQs, intención de compra, env)
  db/                 Schema de Drizzle, cliente, migraciones, repositorios, healthcheck
    repositories/stats.ts  Agregaciones del dashboard (Fase 3)
  engine/             Motor de decisión (ResponseEngine). Aislado a propósito: es lo único
                       que cambia en la Fase 4 al pasar a IA
  waha/               Cliente HTTP de WAHA (sendText) y schemas de sus payloads
  webhook/             Endpoint que recibe eventos de WAHA (valida HMAC, filtra, encola)
  queue/              Cola de procesamiento en memoria (p-queue, concurrency 1)
  conversation/       Orquestador: decide, deriva, envía y persiste; modo degradado (Fase 3)
  dashboard/          Vista HTML de /dashboard, su auth (Fase 3)
tests/engine/         Tests de Vitest del motor de reglas (normalización, matching, decisiones)
scripts/
  simulate-message.mjs  Dispara un mensaje simulado contra el webhook local
ecosystem.config.cjs  Config de PM2 para producción (Fase 3)
```

## Dependencias

| Paquete | Para qué |
|---|---|
| `fastify` | Servidor HTTP del webhook y `/health` |
| `drizzle-orm` + `@libsql/client` | ORM y driver de SQLite (archivo local, sin compilación nativa) |
| `drizzle-kit` | Generación y aplicación de migraciones |
| `zod` | Validación de variables de entorno y de los payloads de WAHA |
| `p-queue` | Cola de procesamiento en memoria para no bloquear el webhook |
| `pino-pretty` | Logs legibles en desarrollo (Fastify usa pino) |
| `vitest` | Tests del motor de reglas |
| `tsx` | Ejecutar TypeScript directo en desarrollo, sin paso de build |

No se agregó ninguna dependencia para lo que Node ya resuelve nativo (`fetch`, `crypto` para el
HMAC, etc.).

## Cómo hacer deploy

Fuera de alcance de la Fase 1 (ver Fase 3 del roadmap: PM2/systemd, auto-restart, healthcheck
externo). Para un ambiente productivo mínimo:

```bash
npm run build       # compila a dist/
npm run db:migrate  # aplica migraciones contra el DATABASE_URL de destino
npm start            # corre dist/server.js
```

Recordá levantar WAHA aparte y apuntar `WAHA_BASE_URL`/`WHATSAPP_HOOK_URL` a las URLs reales del
ambiente (no `localhost`).

## Testing

```bash
npm test          # corre una vez
npm run test:watch  # modo watch
```

Los tests cubren el motor de reglas (`src/engine/`): normalización de texto, matching por tokens
y las decisiones de `RulesEngine` (FAQ, intención de compra, prioridad entre ambas, fallback). Es
lógica pura sin dependencias externas — la elegimos como foco de testing automático porque es la
pieza que se reemplaza en la Fase 4, y estos tests son la red de seguridad para ese cambio.

El resto del flujo (webhook, orquestador, repositorios) se verifica manualmente con
`npm run simulate` en modo dry-run, como se explica arriba.
