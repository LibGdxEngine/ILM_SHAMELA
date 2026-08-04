/**
 * Per-term accent colors, cycled by the term's index in the request array.
 * Shared by the builder rows, active chips, result term-dots and (later) the
 * reader's per-term highlight tinting, so "the blue term" means the same term
 * everywhere. Values sit on the parchment palette without clashing with the
 * gold `--accent`.
 */
export const TERM_COLORS = [
  '#2c6e91', // deep teal-blue
  '#8a4d76', // plum
  '#5c7c3a', // olive green
  '#b0622b', // burnt sienna
] as const;

export function termColor(index: number): string {
  return TERM_COLORS[index % TERM_COLORS.length];
}
