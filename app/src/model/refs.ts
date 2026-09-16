const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** `prefix` + one more than the highest existing number for that prefix. */
export function nextReference(prefix: string, existing: Iterable<string>): string {
  const pattern = new RegExp(`^${escapeRegExp(prefix)}(\\d+)$`, "i");
  let max = 0;
  for (const ref of existing) {
    const match = pattern.exec(ref);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return `${prefix}${max + 1}`;
}

export const nextUid = (prefix: "c" | "w", existing: Iterable<string>): string =>
  nextReference(prefix, existing);

/** Same rule as multysm-core `validate::is_valid_reference`. */
export const isValidReference = (ref: string): boolean => /^[A-Za-z][A-Za-z0-9_]*$/.test(ref);
