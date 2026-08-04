import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // META_PHONE_NUMBER_ID/META_ACCESS_TOKEN son requeridas sin default (ver
    // src/config/env.ts): la mayoría de los tests no importan ese módulo, pero
    // los del engine de IA (Fase 4) sí, vía src/config/env.ts para leer
    // OPENAI_MODEL, y los de messaging/ vía cloudApi/client.ts. Valores
    // ficticios, nunca se usan de verdad (META_DRY_RUN no aplica acá: los tests
    // de parseWebhook/signature son puros y no pegan a la red).
    env: {
      META_PHONE_NUMBER_ID: "test-phone-number-id",
      META_ACCESS_TOKEN: "test-access-token",
    },
  },
});
