import type { CSSProperties } from 'react';

/** The parchment/gold `--shell-*`/`--accent` contract, set explicitly on
 *  surfaces that escape every shell scope (body portals, dark reader panels)
 *  so console components resolve consistent Reading Room colors. */
export const PARCHMENT_SHELL_VARS: CSSProperties = {
  ['--accent' as string]: '#b07d2b',
  ['--accent-2' as string]: '#c99a4e',
  ['--shell-surface' as string]: '#fcf8ee',
  ['--shell-line' as string]: '#e2d5ba',
  ['--shell-muted' as string]: '#8a7d68',
  ['--shell-ink' as string]: '#2c2620',
  ['--shell-ink-2' as string]: '#6e6354',
  ['--shell-rail' as string]: '#f4ecd8',
  ['--shell-on-accent' as string]: '#fcf8ee',
};
