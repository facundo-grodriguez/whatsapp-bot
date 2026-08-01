import { sql } from "drizzle-orm";

import { db } from "./client.js";

/**
 * Verifica que la base responda Y que el schema esté aplicado.
 *
 * Se consulta una tabla real en vez de un `SELECT 1`: con libsql sobre un archivo
 * local, `SELECT 1` responde igual aunque la base esté vacía porque nunca se
 * corrieron las migraciones — es decir, no detectaría justamente el problema más
 * probable en un deploy nuevo.
 */
export async function checkDatabaseHealth(): Promise<boolean> {
  try {
    await db.get(sql`select count(*) from conversations`);
    return true;
  } catch (error) {
    console.error("[health] la base de datos no responde:", error);
    return false;
  }
}
