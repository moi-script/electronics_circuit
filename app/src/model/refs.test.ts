import { describe, expect, it } from "vitest";
import { isValidReference, nextReference, nextUid } from "./refs";

describe("references", () => {
  it("uses the next free number for a prefix, case-insensitively", () => {
    expect(nextReference("R", [])).toBe("R1");
    expect(nextReference("R", ["R1", "r3", "C2", "R7x", "RL1"])).toBe("R4");
    expect(nextReference("GND", ["GND1"])).toBe("GND2");
  });

  it("escapes regex characters in prefixes", () => {
    expect(nextReference("R+", ["R+1", "RR2"])).toBe("R+2");
  });

  it("numbers uids per kind", () => {
    expect(nextUid("c", ["c1", "c9", "w20"])).toBe("c10");
    expect(nextUid("w", ["c1"])).toBe("w1");
  });

  it("validates references like multysm-core", () => {
    for (const ok of ["R1", "r1", "GND_1", "U"]) expect(isValidReference(ok)).toBe(true);
    for (const bad of ["", "1R", "_R", "R 1", "R-1", "R1;"]) expect(isValidReference(bad)).toBe(false);
  });
});
