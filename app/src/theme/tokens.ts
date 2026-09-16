/** Soft-dark theme: the only theme. Mirrored in src/app/globals.css. */
export const tokens = {
  bg: "#1b1d23",
  panel: "#22252d",
  line: "#2e323c",
  text: "#c9ced8",
  muted: "#8a91a0",
  wire: "#7aa2d6",
  accent: "#5fb3a8",
  selected: "#e0b25c",
  error: "#d97a7a",
  grid: "#2c3039",
} as const;

export type TokenName = keyof typeof tokens;
