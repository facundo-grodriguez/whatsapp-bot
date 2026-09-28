import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { sendText } from "../../src/messaging/cloudApi/client.js";

/**
 * Cubre el fix de src/messaging/cloudApi/client.ts (toOutboundRecipient): los
 * wa_id argentinos llegan con un "9" extra después del código de país
 * (549...), pero la Cloud API rechaza el envío a ese mismo string (131030
 * "Recipient phone number not in allowed list") — hay que sacarlo al mandar.
 * Confirmado contra la API real antes de este fix.
 */
describe("sendText — formato del destinatario para Argentina", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ messages: [{ id: "wamid.test" }] }),
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("saca el 9 de un chatId argentino (549...) antes de mandar", async () => {
    await sendText({ channelId: "123", chatId: "5491100000000", text: "hola" });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.to).toBe("541100000000");
  });

  it("no toca un chatId que no empieza con 549 (ej. un número de EE.UU.)", async () => {
    await sendText({ channelId: "123", chatId: "16315551181", text: "hola" });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.to).toBe("16315551181");
  });

  it("no toca un chatId argentino que ya viene sin el 9", async () => {
    await sendText({ channelId: "123", chatId: "541100000000", text: "hola" });

    const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(options.body as string);
    expect(body.to).toBe("541100000000");
  });
});
