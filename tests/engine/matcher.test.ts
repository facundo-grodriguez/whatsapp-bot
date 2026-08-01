import { describe, expect, it } from "vitest";

import { containsPhrase, matchesAnyPhrase } from "../../src/engine/matcher.js";
import { tokenize } from "../../src/engine/normalize.js";

describe("containsPhrase", () => {
  it("matchea una palabra suelta presente en el mensaje", () => {
    expect(containsPhrase(tokenize("¿cuál es el horario?"), "horario")).toBe(true);
  });

  it("matchea una frase de varias palabras como subsecuencia contigua", () => {
    expect(containsPhrase(tokenize("hola, ¿a qué hora abren los sábados?"), "a que hora abren")).toBe(
      true,
    );
  });

  it("no matchea si la frase está en otro orden", () => {
    expect(containsPhrase(tokenize("abren a que hora"), "a que hora abren")).toBe(false);
  });

  it("no matchea substrings dentro de otra palabra (precio vs precioso)", () => {
    expect(containsPhrase(tokenize("qué objeto tan precioso"), "precio")).toBe(false);
  });

  it("no matchea si falta una palabra de la frase", () => {
    expect(containsPhrase(tokenize("hacen envios"), "hacen envios a domicilio")).toBe(false);
  });

  it("devuelve false para frase vacía", () => {
    expect(containsPhrase(tokenize("hola"), "")).toBe(false);
  });
});

describe("matchesAnyPhrase", () => {
  it("matchea si alguna de las frases configuradas está presente", () => {
    const tokens = tokenize("¿cuánto sale el envío?");
    expect(matchesAnyPhrase(tokens, ["comprar", "cuanto sale", "precio"])).toBe(true);
  });

  it("no matchea si ninguna frase está presente", () => {
    const tokens = tokenize("buenas tardes");
    expect(matchesAnyPhrase(tokens, ["comprar", "cuanto sale", "precio"])).toBe(false);
  });
});
