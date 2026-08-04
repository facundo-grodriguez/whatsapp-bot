import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { verifyMetaSignature } from "../../src/messaging/cloudApi/signature.js";

const SECRET = "test-app-secret";

function sign(body: Buffer, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

describe("verifyMetaSignature", () => {
  it("acepta una firma válida", () => {
    const body = Buffer.from(JSON.stringify({ hello: "world" }));
    expect(verifyMetaSignature(body, sign(body, SECRET), SECRET)).toBe(true);
  });

  it("rechaza una firma calculada con otra clave", () => {
    const body = Buffer.from(JSON.stringify({ hello: "world" }));
    expect(verifyMetaSignature(body, sign(body, "otra-clave"), SECRET)).toBe(false);
  });

  it("rechaza si el body fue alterado después de firmarse", () => {
    const original = Buffer.from(JSON.stringify({ hello: "world" }));
    const signature = sign(original, SECRET);
    const alterado = Buffer.from(JSON.stringify({ hello: "mundo" }));
    expect(verifyMetaSignature(alterado, signature, SECRET)).toBe(false);
  });

  it("rechaza si falta el header de firma", () => {
    const body = Buffer.from(JSON.stringify({ hello: "world" }));
    expect(verifyMetaSignature(body, undefined, SECRET)).toBe(false);
  });

  it("rechaza un header sin el prefijo sha256=", () => {
    const body = Buffer.from(JSON.stringify({ hello: "world" }));
    const rawHex = createHmac("sha256", SECRET).update(body).digest("hex");
    expect(verifyMetaSignature(body, rawHex, SECRET)).toBe(false);
  });

  it("rechaza una firma con largo hexadecimal inválido (no explota timingSafeEqual)", () => {
    const body = Buffer.from(JSON.stringify({ hello: "world" }));
    expect(() => verifyMetaSignature(body, "sha256=deadbeef", SECRET)).not.toThrow();
    expect(verifyMetaSignature(body, "sha256=deadbeef", SECRET)).toBe(false);
  });

  it("sin appSecret configurado, no verifica (bypass de desarrollo)", () => {
    const body = Buffer.from(JSON.stringify({ hello: "world" }));
    expect(verifyMetaSignature(body, undefined, undefined)).toBe(true);
    expect(verifyMetaSignature(body, "sha256=lo-que-sea", undefined)).toBe(true);
  });
});
