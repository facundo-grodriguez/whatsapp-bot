import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import { env } from "../config/env.js";
import * as schema from "./schema.js";

// libsql no crea el directorio contenedor del archivo .db si no existe.
// Solo aplica a URLs de archivo local (file:...); las URLs remotas de Turso no pasan por acá.
if (env.DATABASE_URL.startsWith("file:")) {
  const filePath = env.DATABASE_URL.slice("file:".length);
  mkdirSync(dirname(filePath), { recursive: true });
}

const client = createClient({ url: env.DATABASE_URL });

export const db = drizzle(client, { schema });
