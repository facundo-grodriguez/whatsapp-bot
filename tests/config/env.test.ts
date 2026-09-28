import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * env.ts ejecuta loadEnv() al importarse (`export const env = loadEnv()`), así
 * que cada caso necesita: 1) vi.resetModules() para forzar una relectura de
 * process.env en el próximo import, 2) mockear process.exit para que corte la
 * ejecución (igual que en producción) en vez de seguir de largo con datos
 * inválidos, y 3) silenciar console.error para no ensuciar la salida de los
 * tests con los mensajes esperados de configuración inválida.
 */

const REQUIRED_META_ENV = {
  META_PHONE_NUMBER_ID: "test-phone-number-id",
  META_ACCESS_TOKEN: "test-access-token",
  // Requeridas en producción (ver chequeo cruzado en env.ts) — se setean acá
  // para que estos tests se enfoquen solo en las credenciales del dashboard.
  META_APP_SECRET: "test-app-secret",
  META_VERIFY_TOKEN: "test-verify-token",
};

describe("loadEnv — credenciales del dashboard en producción", () => {
  const originalEnv = { ...process.env };
  let exitSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv, ...REQUIRED_META_ENV, NODE_ENV: "production" };
    exitSpy = vi.spyOn(process, "exit").mockImplementation((code) => {
      throw new Error(`process.exit(${code})`);
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.env = originalEnv;
  });

  it("falla si DASHBOARD_USERNAME sigue siendo 'admin' con password seteada", async () => {
    process.env.DASHBOARD_USERNAME = "admin";
    process.env.DASHBOARD_PASSWORD = "una-password-larga-de-verdad";

    await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("falla si DASHBOARD_PASSWORD tiene menos de 12 caracteres", async () => {
    process.env.DASHBOARD_USERNAME = "un-usuario-propio";
    process.env.DASHBOARD_PASSWORD = "corta123";

    await expect(import("../../src/config/env.js")).rejects.toThrow("process.exit(1)");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("arranca si el usuario y la password cumplen los requisitos", async () => {
    process.env.DASHBOARD_USERNAME = "un-usuario-propio";
    process.env.DASHBOARD_PASSWORD = "una-password-larga-de-verdad";

    const { env } = await import("../../src/config/env.js");

    expect(env.DASHBOARD_USERNAME).toBe("un-usuario-propio");
    expect(env.DASHBOARD_PASSWORD).toBe("una-password-larga-de-verdad");
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("no valida nada de esto si DASHBOARD_PASSWORD no está seteada, aunque el usuario sea 'admin'", async () => {
    process.env.DASHBOARD_USERNAME = "admin";
    delete process.env.DASHBOARD_PASSWORD;

    const { env } = await import("../../src/config/env.js");

    expect(env.DASHBOARD_USERNAME).toBe("admin");
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("no bloquea nada de esto en development, aunque el usuario sea 'admin' y la password sea corta", async () => {
    process.env.NODE_ENV = "development";
    process.env.DASHBOARD_USERNAME = "admin";
    process.env.DASHBOARD_PASSWORD = "corta";

    const { env } = await import("../../src/config/env.js");

    expect(env.DASHBOARD_USERNAME).toBe("admin");
    expect(env.DASHBOARD_PASSWORD).toBe("corta");
    expect(exitSpy).not.toHaveBeenCalled();
  });

  it("no bloquea nada de esto en test, aunque el usuario sea 'admin' y la password sea corta", async () => {
    process.env.NODE_ENV = "test";
    process.env.DASHBOARD_USERNAME = "admin";
    process.env.DASHBOARD_PASSWORD = "corta";

    const { env } = await import("../../src/config/env.js");

    expect(env.DASHBOARD_USERNAME).toBe("admin");
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
