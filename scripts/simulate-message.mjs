#!/usr/bin/env node
/**
 * Dispara un mensaje simulado de WAHA contra el webhook local, sin necesidad de
 * tener WAHA corriendo ni un número de WhatsApp conectado. Sirve para probar
 * todo el flujo (motor de reglas -> respuesta -> persistencia) end-to-end.
 *
 * Uso:
 *   npm run simulate -- "¿cuál es el horario?"
 *   npm run simulate -- "quiero comprar" --chat-id 5492222222222@c.us --session ventas
 *
 * Requiere que el servidor esté corriendo (`npm run dev`), idealmente con
 * WAHA_DRY_RUN=true para ver en la consola del servidor qué hubiera respondido
 * el bot sin necesitar WAHA real.
 */

const args = process.argv.slice(2);
const text = args.find((arg) => !arg.startsWith("--"));

if (!text) {
  console.error('Uso: npm run simulate -- "<mensaje>" [--chat-id <id>] [--session <nombre>]');
  process.exit(1);
}

function flagValue(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index !== -1 && args[index + 1] ? args[index + 1] : fallback;
}

const port = process.env.PORT ?? "3001";
const session = flagValue("session", "default");
const chatId = flagValue("chat-id", "5491111111111@c.us");

// Forma del payload verificada contra la documentación de WAHA:
// https://waha.devlike.pro/docs/how-to/events/
const payload = {
  event: "message",
  session,
  payload: {
    id: `sim-${Date.now()}`,
    timestamp: Math.floor(Date.now() / 1000),
    from: chatId,
    fromMe: false,
    to: `${session}@c.us`,
    body: text,
    hasMedia: false,
  },
};

const url = `http://localhost:${port}/webhook/waha`;

console.log(`-> POST ${url}`);
console.log(`   session="${session}" chatId="${chatId}" body="${text}"`);

let response;
try {
  response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
} catch (error) {
  console.error(`No se pudo conectar a ${url}. ¿Está el servidor corriendo? (npm run dev)`);
  console.error(error.message);
  process.exit(1);
}

const responseBody = await response.json().catch(() => null);
console.log(`<- ${response.status}`, responseBody);

if (!response.ok) {
  process.exit(1);
}
