import { describe, expect, it } from "vitest";

import { pickRandom } from "../../src/engine/variant.js";

describe("pickRandom", () => {
  it("siempre devuelve el único elemento de un array de longitud 1", () => {
    expect(pickRandom(["a"])).toBe("a");
  });

  it("solo devuelve elementos que pertenecen al array de entrada", () => {
    const items = ["a", "b", "c"];

    for (let i = 0; i < 50; i++) {
      expect(items).toContain(pickRandom(items));
    }
  });
});
