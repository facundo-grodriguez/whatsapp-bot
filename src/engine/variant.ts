/**
 * Elige una variante al azar entre varias respuestas equivalentes. Evita que el
 * bot conteste siempre con el mismo texto exacto ante la misma FAQ, algo que es
 * una señal fácil de detectar como automatización.
 */
export function pickRandom<T>(items: readonly T[]): T {
  const index = Math.floor(Math.random() * items.length);
  return items[index] as T;
}
