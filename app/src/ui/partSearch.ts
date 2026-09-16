import type { PartDef } from "@/model/types";

export function filterParts(parts: PartDef[], query: string): PartDef[] {
  const q = query.trim().toLowerCase();
  const matches = q === ""
    ? parts
    : parts.filter(({ manifest: m }) =>
        [m.name, m.id, m.category, ...m.tags].some((field) => field.toLowerCase().includes(q)));
  return [...matches].sort((a, b) => a.manifest.name.localeCompare(b.manifest.name));
}
