/**
 * Engineering value parser. Must match multysm-core `si::parse_si`:
 * `meg` (any case) and `M` = 1e6, `m` = 1e-3, `f` = 1e-15, `F` = farad (x1);
 * other scale letters case-insensitive; unknown trailing letters are units.
 */
export type SiResult = { ok: true; value: number } | { ok: false; error: string };

export function parseSi(input: string): SiResult {
  const s = input.trim();
  if (s === "") return { ok: false, error: "Enter a value" };
  const match = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(s);
  if (!match) return { ok: false, error: `'${s}' is not a number` };
  const mantissa = match[0];
  const exponent = scaleExponent(s.slice(mantissa.length));
  // Parse "4.7e3" rather than computing 4.7 * 1000, which is not exact.
  const value = exponent === 0
    ? Number(mantissa)
    : /[eE]/.test(mantissa)
      ? Number(mantissa) * 10 ** exponent
      : Number(`${mantissa}e${exponent}`);
  if (!Number.isFinite(value)) return { ok: false, error: `'${s}' is out of range` };
  return { ok: true, value };
}

function scaleExponent(suffix: string): number {
  const rest = suffix.trim();
  if (rest.toLowerCase().startsWith("meg")) return 6;
  switch (rest.charAt(0)) {
    case "T": case "t": return 12;
    case "G": case "g": return 9;
    case "M": return 6;
    case "K": case "k": return 3;
    case "m": return -3;
    case "U": case "u": case "µ": case "μ": return -6;
    case "N": case "n": return -9;
    case "P": case "p": return -12;
    case "f": return -15;
    default: return 0;
  }
}
