import { describe, expect, it } from "vitest";

import { parseWebhook } from "../../src/messaging/cloudApi/parseWebhook.js";

const CHANNEL_ID = "123456789012345";
const CHAT_ID = "5491111111111";

function envelope(...changes: unknown[]) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "waba-id", changes }],
  };
}

function messagesChange(value: Record<string, unknown>) {
  return {
    field: "messages",
    value: {
      messaging_product: "whatsapp",
      metadata: { phone_number_id: CHANNEL_ID, display_phone_number: "15550001111" },
      ...value,
    },
  };
}

function textMessage(overrides: Record<string, unknown> = {}) {
  return {
    id: "wamid.ONE",
    from: CHAT_ID,
    timestamp: "1700000000",
    type: "text",
    text: { body: "hola" },
    ...overrides,
  };
}

describe("parseWebhook — mensajes de texto", () => {
  it("parsea un mensaje simple", () => {
    const result = parseWebhook(envelope(messagesChange({ messages: [textMessage()] })));

    expect(result.messages).toEqual([
      {
        providerMessageId: "wamid.ONE",
        channelId: CHANNEL_ID,
        chatId: CHAT_ID,
        senderName: null,
        body: "hola",
        timestamp: new Date(1700000000 * 1000),
      },
    ]);
    expect(result.statuses).toEqual([]);
    expect(result.ignored).toEqual([]);
  });

  it("extrae el nombre del remitente desde contacts[]", () => {
    const result = parseWebhook(
      envelope(
        messagesChange({
          contacts: [{ wa_id: CHAT_ID, profile: { name: "Juana" } }],
          messages: [textMessage()],
        }),
      ),
    );

    expect(result.messages[0]?.senderName).toBe("Juana");
  });

  it("senderName es null si el wa_id no matchea ningún contacto", () => {
    const result = parseWebhook(
      envelope(
        messagesChange({
          contacts: [{ wa_id: "otro-numero", profile: { name: "Juana" } }],
          messages: [textMessage()],
        }),
      ),
    );

    expect(result.messages[0]?.senderName).toBeNull();
  });

  it("parsea un lote de N mensajes de chats distintos en un solo payload", () => {
    const result = parseWebhook(
      envelope(
        messagesChange({
          messages: [
            textMessage({ id: "wamid.A", from: "5491100000001", text: { body: "uno" } }),
            textMessage({ id: "wamid.B", from: "5491100000002", text: { body: "dos" } }),
            textMessage({ id: "wamid.C", from: "5491100000003", text: { body: "tres" } }),
          ],
        }),
      ),
    );

    expect(result.messages).toHaveLength(3);
    expect(result.messages.map((m) => m.chatId)).toEqual([
      "5491100000001",
      "5491100000002",
      "5491100000003",
    ]);
  });

  it("mensaje + status en el mismo payload se separan correctamente", () => {
    const result = parseWebhook(
      envelope(
        messagesChange({
          messages: [textMessage()],
          statuses: [{ id: "wamid.OUT", status: "delivered", recipient_id: CHAT_ID }],
        }),
      ),
    );

    expect(result.messages).toHaveLength(1);
    expect(result.statuses).toHaveLength(1);
  });

  it("timestamp inválido o ausente da null, no tira", () => {
    const invalido = parseWebhook(
      envelope(messagesChange({ messages: [textMessage({ timestamp: "no-es-un-numero" })] })),
    );
    expect(invalido.messages[0]?.timestamp).toBeNull();

    const ausente = parseWebhook(
      envelope(messagesChange({ messages: [textMessage({ timestamp: undefined })] })),
    );
    expect(ausente.messages[0]?.timestamp).toBeNull();
  });
});

describe("parseWebhook — descartes (ignored)", () => {
  it("tipo no soportado (imagen) se ignora con motivo unsupported_type", () => {
    const result = parseWebhook(
      envelope(
        messagesChange({
          messages: [{ id: "wamid.IMG", from: CHAT_ID, type: "image", image: { id: "media-id" } }],
        }),
      ),
    );

    expect(result.messages).toEqual([]);
    expect(result.ignored).toEqual([{ reason: "unsupported_type", detail: "image" }]);
  });

  it("body vacío o solo espacios se ignora con motivo empty_body", () => {
    const result = parseWebhook(
      envelope(messagesChange({ messages: [textMessage({ text: { body: "   " } }), textMessage({ text: {} })] })),
    );

    expect(result.messages).toEqual([]);
    expect(result.ignored).toEqual([{ reason: "empty_body" }, { reason: "empty_body" }]);
  });

  it("un change con field distinto de 'messages' se ignora con motivo unknown_field", () => {
    const result = parseWebhook(
      envelope({
        field: "message_template_status_update",
        value: { event: "APPROVED" },
      }),
    );

    expect(result.messages).toEqual([]);
    expect(result.ignored).toEqual([
      { reason: "unknown_field", detail: "message_template_status_update" },
    ]);
  });

  it("un mensaje malformado dentro de un lote no descarta a los demás", () => {
    const result = parseWebhook(
      envelope(
        messagesChange({
          messages: [
            textMessage({ id: "wamid.OK1" }),
            { from: CHAT_ID, type: "text", text: { body: "sin id" } }, // falta "id" requerido
            textMessage({ id: "wamid.OK2", from: "5491100000009" }),
          ],
        }),
      ),
    );

    expect(result.messages).toHaveLength(2);
    expect(result.messages.map((m) => m.providerMessageId)).toEqual(["wamid.OK1", "wamid.OK2"]);
    expect(result.ignored).toEqual([{ reason: "invalid_payload", detail: "message" }]);
  });
});

describe("parseWebhook — payloads irreconocibles: nunca tira, listas vacías", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["string suelto", "no soy un payload"],
    ["objeto vacío", {}],
    ["array en vez de objeto", []],
    ["entry no es un array", { object: "whatsapp_business_account", entry: "no-array" }],
    ["number", 42],
  ])("payload basura (%s) no tira y devuelve listas vacías", (_label, payload) => {
    expect(() => parseWebhook(payload)).not.toThrow();
    const result = parseWebhook(payload);
    expect(result.messages).toEqual([]);
    expect(result.statuses).toEqual([]);
  });

  it("entry sin changes no tira", () => {
    const result = parseWebhook({ object: "whatsapp_business_account", entry: [{ id: "x" }] });
    expect(result.messages).toEqual([]);
    expect(result.statuses).toEqual([]);
  });

  it("change.value sin metadata.phone_number_id se ignora (no se puede determinar channelId)", () => {
    const result = parseWebhook(
      envelope({
        field: "messages",
        value: { messaging_product: "whatsapp", messages: [textMessage()] },
      }),
    );

    expect(result.messages).toEqual([]);
    expect(result.ignored).toEqual([{ reason: "invalid_payload", detail: "change.value" }]);
  });
});

describe("parseWebhook — acuses de estado (statuses)", () => {
  it("parsea un status simple", () => {
    const result = parseWebhook(
      envelope(
        messagesChange({
          statuses: [{ id: "wamid.OUT1", status: "delivered", timestamp: "1700000100", recipient_id: CHAT_ID }],
        }),
      ),
    );

    expect(result.statuses).toEqual([
      {
        providerMessageId: "wamid.OUT1",
        channelId: CHANNEL_ID,
        chatId: CHAT_ID,
        status: "delivered",
        timestamp: new Date(1700000100 * 1000),
        errorCode: null,
        errorTitle: null,
      },
    ]);
  });

  it("un status 'failed' trae el código y título del primer error", () => {
    const result = parseWebhook(
      envelope(
        messagesChange({
          statuses: [
            {
              id: "wamid.OUT2",
              status: "failed",
              recipient_id: CHAT_ID,
              errors: [{ code: 131047, title: "Re-engagement message" }],
            },
          ],
        }),
      ),
    );

    expect(result.statuses[0]?.errorCode).toBe(131047);
    expect(result.statuses[0]?.errorTitle).toBe("Re-engagement message");
  });

  it("un status con valor desconocido se ignora en vez de mentir con un tipo inválido", () => {
    const result = parseWebhook(
      envelope(messagesChange({ statuses: [{ id: "wamid.X", status: "queued", recipient_id: CHAT_ID }] })),
    );

    expect(result.statuses).toEqual([]);
    expect(result.ignored).toEqual([{ reason: "invalid_payload", detail: "status:queued" }]);
  });

  it("varios statuses de un batch grande se procesan todos", () => {
    const result = parseWebhook(
      envelope(
        messagesChange({
          statuses: [
            { id: "wamid.S1", status: "sent", recipient_id: "5491100000001" },
            { id: "wamid.S2", status: "delivered", recipient_id: "5491100000002" },
            { id: "wamid.S3", status: "read", recipient_id: "5491100000003" },
          ],
        }),
      ),
    );

    expect(result.statuses).toHaveLength(3);
  });
});
