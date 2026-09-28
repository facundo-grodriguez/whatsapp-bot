#!/usr/bin/env node
/**
 * Dispara un webhook simulado de la Cloud API de Meta contra el servidor local,
 * sin necesidad de cuenta de Meta ni número de prueba conectado. Sirve para
 * probar todo el flujo (parseo -> motor de reglas -> respuesta -> persistencia)
 * end-to-end, y para probar concurrencia: Meta puede empaquetar varios mensajes
 * de chats distintos en un solo POST — así que `--chats`/`--count` arman un
 * solo request con todos adentro, en vez de disparar N requests en paralelo.
 *
 * Uso:
 *   npm run simulate -- "¿cuál es el horario?"
 *   npm run simulate -- "quiero comprar" --chat-id 5492222222222 --channel-id 999
 *   npm run simulate -- "hola" --count 3            # 3 mensajes, mismo chat, en orden
 *   npm run simulate -- "hola" --chats 20 --count 2 # 40 mensajes, 20 chats, un solo POST
 *   npm run simulate -- --message-id wamid.FIJO     # repetir un id -> prueba de idempotencia
 *   npm run simulate -- --status failed             # acuse de estado en vez de un mensaje
 *   npm run simulate -- --verify                    # ejercita el GET de verificación
 *
 * Requiere que el servidor esté corriendo (`npm run dev`), idealmente con
 * META_DRY_RUN=true para ver en la consola del servidor qué hubiera respondido
 * el bot sin necesitar credenciales reales de Meta.
 */

import { createHmac } from "node:crypto";

const args = process.argv.slice(2);
const text = args.find((arg) => !arg.startsWith("--"));

function flagValue(name, fallback) {
  const index = args.indexOf(`--${name}`);
  return index !== -1 && args[index + 1] ? args[index + 1] : fallback;
}

function hasFlag(name) {
  return args.includes(`--${name}`);
}

const port = process.env.PORT ?? "3001";
const baseUrl = `http://localhost:${port}`;
const channelId = flagValue("channel-id", process.env.META_PHONE_NUMBER_ID ?? "1000000000000");

if (hasFlag("verify")) {
  await runVerify();
} else if (hasFlag("status")) {
  await runStatus();
} else {
  await runMessages();
}

/** GET /webhook/whatsapp — ejercita la verificación que hace Meta al cargar la Callback URL. */
async function runVerify() {
  const token = flagValue("token", process.env.META_VERIFY_TOKEN ?? "");
  const challenge = flagValue("challenge", `challenge-${Date.now()}`);
  const url =
    `${baseUrl}/webhook/whatsapp?hub.mode=subscribe` +
    `&hub.verify_token=${encodeURIComponent(token)}&hub.challenge=${encodeURIComponent(challenge)}`;

  console.log(`-> GET ${url}`);
  const response = await request(url, { method: "GET" });
  const body = await response.text();
  console.log(`<- ${response.status}`, body);
  process.exitCode = response.ok ? 0 : 1;
}

/** Arma un acuse de estado (sent/delivered/read/failed) en vez de un mensaje. */
async function runStatus() {
  const status = flagValue("status", "delivered");
  const chatId = flagValue("chat-id", "5491111111111");
  const providerMessageId = flagValue("message-id", `wamid.SIM${Date.now()}`);

  const value = {
    messaging_product: "whatsapp",
    metadata: { phone_number_id: channelId, display_phone_number: channelId },
    statuses: [
      {
        id: providerMessageId,
        status,
        timestamp: String(Math.floor(Date.now() / 1000)),
        recipient_id: chatId,
        ...(status === "failed"
          ? { errors: [{ code: 131047, title: "Re-engagement message" }] }
          : {}),
      },
    ],
  };

  await postWebhook(envelope(value));
}

/** Arma N mensajes en M chats, todos en un solo POST (ver comentario de arriba). */
async function runMessages() {
  if (!text) {
    console.error(
      'Uso: npm run simulate -- "<mensaje>" [--chat-id <id>] [--channel-id <id>] ' +
        "[--count <n>] [--chats <n>] [--message-id <id>]",
    );
    process.exitCode = 1;
    return;
  }

  const count = Number(flagValue("count", "1"));
  const chats = Number(flagValue("chats", "1"));
  const baseChatId = BigInt(flagValue("chat-id", "5491100000000"));
  const fixedMessageId = flagValue("message-id", undefined);

  const messages = [];
  for (let chatIndex = 0; chatIndex < chats; chatIndex++) {
    const chatId = String(baseChatId + BigInt(chatIndex));
    for (let n = 1; n <= count; n++) {
      const body = count > 1 || chats > 1 ? `${text} #${n}` : text;
      messages.push({
        id: fixedMessageId ?? `wamid.SIM${Date.now()}${Math.random().toString(36).slice(2, 8)}`,
        from: chatId,
        timestamp: String(Math.floor(Date.now() / 1000)),
        type: "text",
        text: { body },
      });
    }
  }

  const value = {
    messaging_product: "whatsapp",
    metadata: { phone_number_id: channelId, display_phone_number: channelId },
    contacts: [...new Set(messages.map((m) => m.from))].map((wa_id) => ({
      wa_id,
      profile: { name: "Cliente de prueba" },
    })),
    messages,
  };

  console.log(`   ${messages.length} mensaje(s), ${chats} chat(s), channelId="${channelId}"`);
  await postWebhook(envelope(value));
}

function envelope(value) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "waba-simulada", changes: [{ field: "messages", value }] }],
  };
}

async function postWebhook(payload) {
  const url = `${baseUrl}/webhook/whatsapp`;
  const bodyText = JSON.stringify(payload);
  const headers = { "Content-Type": "application/json" };

  const appSecret = process.env.META_APP_SECRET;
  if (appSecret) {
    const hex = createHmac("sha256", appSecret).update(bodyText).digest("hex");
    // Para --bad-signature: flipear el primer carácter (no agregar uno al final
    // — Buffer.from(hex, "hex") trunca en silencio un hex de largo impar, así
    // que agregar un solo char termina generando el MISMO buffer que el original).
    const corrupted = (hex[0] === "0" ? "1" : "0") + hex.slice(1);
    headers["X-Hub-Signature-256"] = `sha256=${hasFlag("bad-signature") ? corrupted : hex}`;
  } else if (hasFlag("bad-signature")) {
    console.warn("--bad-signature no tiene efecto sin META_APP_SECRET seteada (no se firma nada).");
  }

  console.log(`-> POST ${url}`);
  const response = await request(url, { method: "POST", headers, body: bodyText });
  const responseBody = await response.json().catch(() => null);
  console.log(`<- ${response.status}`, responseBody);
  process.exitCode = response.ok ? 0 : 1;
}

async function request(url, options) {
  try {
    return await fetch(url, options);
  } catch (error) {
    console.error(`No se pudo conectar a ${url}. ¿Está el servidor corriendo? (npm run dev)`);
    console.error(error.message);
    process.exit(1);
  }
}
