const PREFIXES: [number, string][] = [
  [1e9, "G"], [1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"], [1e-15, "f"],
];

/** Engineering notation with 3 significant figures, e.g. `4.97 V`, `3.30 mV`, `−12.0 V`. */
export function formatValue(value: number, unit: string, options: { trim?: boolean } = {}): string {
  if (!Number.isFinite(value)) return `— ${unit}`;
  const abs = Math.abs(value);
  if (abs < 1e-18) return `0 ${unit}`;
  let i = PREFIXES.findIndex(([scale]) => abs >= scale);
  if (i === -1) i = PREFIXES.length - 1;
  let text = (abs / PREFIXES[i][0]).toPrecision(3);
  if (Number(text) >= 1000 && i > 0) {
    i -= 1;
    text = (abs / PREFIXES[i][0]).toPrecision(3);
  }
  if (options.trim) text = String(Number(text));
  return `${value < 0 ? "−" : ""}${text} ${PREFIXES[i][1]}${unit}`;
}
