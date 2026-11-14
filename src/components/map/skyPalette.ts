import { useMemo } from 'react';

import { buildThemeColors, useAccent, type ThemeColors } from '../theme';

// ============================================================================
// MY SKY'S OWN COLORS (CONSTELLATION_SKY_PLAN.md, stage 3)
// ----------------------------------------------------------------------------
// My sky is always a night sky, in light mode too, so the sky canvas does not
// follow the app's theme: these are its fixed night colors. The stars, lines
// and labels still draw from a ThemeColors-shaped palette (the dark one, with
// the sky's own ink and background laid over it), so the existing drawing code
// is reused as is. Popups and buttons outside the canvas stay in the app theme.
// ============================================================================

// The night is a warm near-black with no hue of its own (it was deep blue until
// 2026-11-14): beside any accent the page then reads as two colors, the accent
// and star gold, instead of three.
export const SKY = {
  /** The sky itself. */
  bg: '#0B0A09',
  /** A little lighter, for the panel under the canvas. */
  bgSoft: '#1A1816',
  edge: '#2E2B27',
  ink: '#F2EEE7',
  ink2: '#CFC8BD',
  ink3: '#9D958A',
  /** Hidden stars: a soft warm-white glow. */
  glow: '#E9DFC8',
  /** The user's own links: pale, dashed. */
  link: '#CFC8BD',
  /** Gold stars on the Home button. */
  star: '#E8BE45',
  /** The NEXT marker and the focused star's ring. */
  next: '#F5D27A',
  /** A completed constellation's lines (Stage 4's payoff). */
  gold: '#FFC83D',
} as const;

/** The dark palette, with the night sky's ink laid over it. */
export function buildSkyPalette(base: ThemeColors): ThemeColors {
  return {
    ...base,
    canvas: SKY.bg,
    surface: SKY.bg,
    surface2: SKY.bgSoft,
    line: SKY.edge,
    lineStrong: SKY.edge,
    hairline: SKY.edge,
    ink: SKY.ink,
    ink2: SKY.ink2,
    ink3: SKY.ink3,
  };
}

/** The sky's palette for the user's accent (always the dark scheme). */
export function useSkyPalette(): ThemeColors {
  const { accentId } = useAccent();
  return useMemo(() => buildSkyPalette(buildThemeColors(accentId, 'dark')), [accentId]);
}

/** A fixed scatter of tiny background stars (percent of the box), so the sky isn't flat. Deterministic. */
export const BACKDROP_STARS: { x: number; y: number; r: number; o: number }[] = (() => {
  const out: { x: number; y: number; r: number; o: number }[] = [];
  let s = 20261111;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
  for (let i = 0; i < 46; i++) out.push({ x: rnd() * 100, y: rnd() * 100, r: 0.5 + rnd() * 1.1, o: 0.25 + rnd() * 0.5 });
  return out;
})();
