import { defineConfig } from "drizzle-kit";

// dialect "turso" es la vía soportada por drizzle-kit para bases libsql,
// incluyendo archivos locales (url: "file:...") sin authToken.
export default defineConfig({
  dialect: "turso",
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL ?? "file:./data/bot.db",
  },
});
