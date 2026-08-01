import { tokenize } from "./normalize.js";

/**
 * ¿Los tokens de `phrase` aparecen como subsecuencia contigua dentro de `messageTokens`?
 * Comparar por tokens completos (no por substring) evita falsos positivos como
 * que "precio" matchee dentro de "precioso".
 */
export function containsPhrase(messageTokens: string[], phrase: string): boolean {
  const phraseTokens = tokenize(phrase);
  if (phraseTokens.length === 0 || phraseTokens.length > messageTokens.length) {
    return false;
  }

  for (let start = 0; start <= messageTokens.length - phraseTokens.length; start++) {
    const matches = phraseTokens.every((token, offset) => messageTokens[start + offset] === token);
    if (matches) return true;
  }

  return false;
}

/** ¿Alguna de las frases configuradas matchea el mensaje? */
export function matchesAnyPhrase(messageTokens: string[], phrases: readonly string[]): boolean {
  return phrases.some((phrase) => containsPhrase(messageTokens, phrase));
}
