import { sql } from "drizzle-orm";

import { db } from "../client.js";
import { categories } from "../schema.js";

export interface CategoryDefinition {
  slug: string;
  label: string;
}

/**
 * Inserta o actualiza el catálogo de categorías. Es idempotente a propósito: se
 * llama en cada arranque del servidor para que el catálogo nunca quede desalineado
 * con las categorías que usan las reglas de `/config` (FK de messages.category).
 */
export async function upsertCategories(defs: CategoryDefinition[]): Promise<void> {
  if (defs.length === 0) return;

  await db
    .insert(categories)
    .values(defs)
    .onConflictDoUpdate({
      target: categories.slug,
      set: { label: sql`excluded.label` },
    });
}
