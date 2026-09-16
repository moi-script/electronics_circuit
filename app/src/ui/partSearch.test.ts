import { describe, expect, it } from "vitest";
import { testLibrary } from "@/test/resetEditor";
import { filterParts } from "./partSearch";

const ids = (query: string) => filterParts(testLibrary.parts, query).map((p) => p.manifest.id);

describe("filterParts", () => {
  it("returns every part sorted by name for an empty query", () => {
    const all = filterParts(testLibrary.parts, "  ");
    expect(all).toHaveLength(8);
    expect(all.map((p) => p.manifest.name)).toEqual([...all.map((p) => p.manifest.name)].sort());
  });

  it("matches names, ids, tags and categories case-insensitively", () => {
    expect(ids("resist")).toEqual(["basic.resistor"]);
    expect(ids("NAND")).toEqual(["ttl.7400"]);
    expect(ids("ttl")).toEqual(["ttl.7400"]);
    expect(ids("555")).toEqual(["mixed.555"]);
    expect(ids("zzz")).toEqual([]);
  });
});
