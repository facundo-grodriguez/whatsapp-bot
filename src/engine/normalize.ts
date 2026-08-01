const DIACRITICS_REGEX = /[\u0300-\u036f]/g;
const NON_ALPHANUMERIC_REGEX = /[^\p{L}\p{N}\s]/gu;
const EXTRA_SPACES_REGEX = /\s+/g;

/**
 * Normaliza texto libre para matching: minúsculas, sin tildes/diacríticos, sin
 * puntuación, espacios colapsados. "¿Cuál es el HORARIO?" y "cual es el horario"
 * terminan siendo el mismo string normalizado.
 */
export function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    // La descomposición NFD separa cada letra acentuada en (letra base + marca
    // diacrítica). DIACRITICS_REGEX elimina esas marcas (rango Unicode U+0300-U+036F).
    .replace(DIACRITICS_REGEX, "")
    .replace(NON_ALPHANUMERIC_REGEX, " ") // quita puntuación y emojis, conserva letras/números de cualquier idioma
    .replace(EXTRA_SPACES_REGEX, " ")
    .trim();
}

/** Tokeniza el texto ya normalizado en palabras individuales. */
export function tokenize(text: string): string[] {
  const normalized = normalizeText(text);
  return normalized.length === 0 ? [] : normalized.split(" ");
}
