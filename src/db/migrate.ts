import { migrate } from "drizzle-orm/libsql/migrator";

import { db } from "./client.js";

async function main() {
  console.log("Aplicando migraciones...");
  await migrate(db, { migrationsFolder: "./src/db/migrations" });
  console.log("Migraciones aplicadas correctamente.");
  process.exit(0);
}

main().catch((error) => {
  console.error("Error aplicando migraciones:", error);
  process.exit(1);
});
