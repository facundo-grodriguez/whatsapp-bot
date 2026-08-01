import { describe, expect, it } from "vitest";

import { normalizeText, tokenize } from "../../src/engine/normalize.js";

describe("normalizeText", () => {
  it("pasa a minúsculas", () => {
    expect(normalizeText("HORARIO")).toBe("horario");
  });

  it("quita tildes y diacríticos", () => {
    expect(normalizeText("¿Cuál es el horario?")).toBe("cual es el horario");
  });

  it("quita puntuación", () => {
    expect(normalizeText("¡Hola!! ¿Cómo andás?")).toBe("hola como andas");
  });

  it("colapsa espacios múltiples", () => {
    expect(normalizeText("cuanto   sale   esto")).toBe("cuanto sale esto");
  });

  it("recorta espacios al inicio y al final", () => {
    expect(normalizeText("  hola  ")).toBe("hola");
  });

  it("devuelve string vacío para texto vacío", () => {
    expect(normalizeText("")).toBe("");
  });
});

describe("tokenize", () => {
  it("separa el texto normalizado en palabras", () => {
    expect(tokenize("¿Cuál es el horario?")).toEqual(["cual", "es", "el", "horario"]);
  });

  it("devuelve array vacío para texto vacío o solo puntuación", () => {
    expect(tokenize("")).toEqual([]);
    expect(tokenize("¡¡¡!!!")).toEqual([]);
  });
});
