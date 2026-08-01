# Asistente de WhatsApp — Fase 1 (motor de reglas)

Bot de atención al primer contacto por WhatsApp: responde preguntas frecuentes automáticamente,
detecta intención de compra y deriva la conversación a un vendedor humano cuando corresponde.

Esta es la **Fase 1** de un producto pensado para escalar en 4 fases (ver `CLAUDE.md` para el
detalle completo). En esta fase:

- Una sola sesión de WhatsApp (multi-sesión es Fase 2).
- Motor de respuestas por **reglas de palabras clave**, sin IA (IA es Fase 4).
- Sin dashboard todavía (Fase 3): todo por endpoints JSON.
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
  (frases que activan la regla) y `response`. La primera regla que matchea gana.
- **`src/config/purchaseIntent.ts`** — palabras/frases que se interpretan como intención de
  compra (derivan la conversación a un vendedor).
- **`src/config/messages.ts`** — mensaje genérico de fallback y mensaje de derivación.
- **`src/config/categories.ts`** — se arma solo a partir de los dos archivos anteriores; no hace
  falta tocarlo salvo que agregues una categoría fuera de una FAQ o de intención de compra.

El texto se normaliza (minúsculas, sin tildes, sin puntuación) antes de matchear, y las frases se
comparan por secuencia de palabras completas — así `"precio"` no matchea dentro de `"precioso"`.

Después de editar las reglas, no hace falta migrar nada: el catálogo de categorías se sincroniza
solo en cada arranque del servidor.

## Estructura

```
src/
  server.ts          Arranque de Fastify: rutas, seed de categorías, shutdown ordenado
  config/             Todo lo específico del negocio (FAQs, intención de compra, env)
  db/                 Schema de Drizzle, cliente, migraciones, repositorios
  engine/             Motor de decisión (ResponseEngine). Aislado a propósito: es lo único
                       que cambia en la Fase 4 al pasar a IA
  waha/               Cliente HTTP de WAHA (sendText) y schemas de sus payloads
  webhook/             Endpoint que recibe eventos de WAHA (valida HMAC, filtra, encola)
  queue/              Cola de procesamiento en memoria (p-queue, concurrency 1)
  conversation/       Orquestador: decide, deriva, envía y persiste
tests/engine/         Tests de Vitest del motor de reglas (normalización, matching, decisiones)
scripts/
  simulate-message.mjs  Dispara un mensaje simulado contra el webhook local
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
