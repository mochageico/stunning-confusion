import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { Platform, View } from 'react-native';
import { vars } from 'nativewind';
import AsyncStorage from '@react-native-async-storage/async-storage';

// ============================================================================
// THEME
//
// Every color the app draws with, by role rather than by hex. Two consumers:
//
//   - className: `text-ink`, `bg-surface`, `border-line`, `bg-accent`... are
//     defined in tailwind.config.js as `rgb(var(--ink) / <alpha-value>)`.
//     ThemeProvider sets those variables at the app root with NativeWind's
//     `vars()`, so changing the accent recolors every class at once, and
//     opacity modifiers (`bg-danger/10`) still work.
//   - JS props that can't read a CSS variable (lucide `color`,
//     `placeholderTextColor`, ActivityIndicator): `useThemeColors()` returns
//     the same palette as hex strings.
//
// The accent is the user's choice (Settings > Appearance > Accent color), so
// no screen may hardcode an accent hex. Neutrals, status and stage colors are
// fixed per scheme. Dark values are defined here but the app still renders
// light: turning dark mode on later means choosing the scheme, not recoloring
// the app.
// ============================================================================

export type ColorScheme = 'light' | 'dark';

export const ACCENTS = [
  { id: 'navy', name: 'Navy', light: '#294C82', dark: '#8FB0E8' },
  { id: 'evergreen', name: 'Evergreen', light: '#2D6A4F', dark: '#7CC4A0' },
  { id: 'burgundy', name: 'Burgundy', light: '#8A2E3B', dark: '#E59AA6' },
  { id: 'plum', name: 'Plum', light: '#6A3F8E', dark: '#C4A5E8' },
  { id: 'walnut', name: 'Walnut', light: '#7A4E2B', dark: '#D9AE84' },
  { id: 'ink', name: 'Ink', light: '#2B2824', dark: '#E6E0D6' },
] as const;

export type AccentId = (typeof ACCENTS)[number]['id'];
export const DEFAULT_ACCENT: AccentId = 'navy';

const isAccentId = (v: unknown): v is AccentId => ACCENTS.some((a) => a.id === v);

// Every accent was checked at 4.5:1 or better on surface, canvas, its own
// accent-soft and as button text, in both schemes. So were ink-3 and the
// status colors below. Stage colors are for dots and stripes only: daily and
// monthly are under 4.5:1 as text on light, so stage labels are ink.
const NEUTRALS = {
  light: {
    canvas: '#EFECE6', // the page behind cards
    surface: '#FFFDF9', // cards, sheets, inputs
    surface2: '#F6F3EE', // an inset panel inside a card
    fill: '#E5E0D6', // segmented-control tray, tracks, idle chips
    raised: '#FFFDF9', // the selected segment sitting in a fill tray
    line: '#E2DDD4', // card and input borders
    lineStrong: '#D9D3C8', // outlined buttons and chips
    hairline: '#ECE7DF', // dividers inside a card
    ink: '#1E1C19', // primary text
    ink2: '#4E4943', // secondary text
    ink3: '#6E675E', // tertiary text: captions, hints, placeholders
    onAccent: '#FFFFFF',
  },
  dark: {
    canvas: '#141311',
    surface: '#1F1D1A',
    surface2: '#262320',
    fill: '#272420',
    raised: '#3A3631',
    line: '#2E2B27',
    lineStrong: '#3B3833',
    hairline: '#2E2B27',
    ink: '#F2EEE7',
    ink2: '#CFC8BD',
    ink3: '#9D958A',
    onAccent: '#0B0B0D',
  },
} as const;

const STATUS = {
  light: { success: '#276F4B', warning: '#8C5A0B', danger: '#B3261E' },
  dark: { success: '#5CC993', warning: '#E3B04B', danger: '#F2998F' },
} as const;

/** Review stages. The same four everywhere a stage is shown. */
const STAGES = {
  light: { stageLearning: '#6E4BB8', stageDaily: '#2E9A68', stageWeekly: '#3A6BD6', stageMonthly: '#C0831A' },
  dark: { stageLearning: '#B79CF0', stageDaily: '#4CC38A', stageWeekly: '#7BA1F2', stageMonthly: '#E3B04B' },
} as const;

export interface ThemeColors {
  canvas: string;
  surface: string;
  surface2: string;
  fill: string;
  raised: string;
  line: string;
  lineStrong: string;
  hairline: string;
  ink: string;
  ink2: string;
  ink3: string;
  accent: string;
  /** 13% accent over the surface color: selected rows, the active tab, info panels. */
  accentSoft: string;
  /** Text and icons on an accent fill. */
  onAccent: string;
  success: string;
  successSoft: string;
  warning: string;
  warningSoft: string;
  danger: string;
  dangerSoft: string;
  stageLearning: string;
  stageDaily: string;
  stageWeekly: string;
  stageMonthly: string;
}

const hexToRgb = (hex: string) => {
  const h = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
};

/**
 * `amount` of `color` laid over `base`. RN has no color-mix(), so the soft
 * tints are computed here instead of with an opacity modifier: an opacity tint
 * would change with whatever sits behind it, and these have to stay readable.
 */
function mix(color: string, base: string, amount: number) {
  const a = hexToRgb(color);
  const b = hexToRgb(base);
  return (
    '#' +
    a
      .map((v, i) => Math.round(v * amount + b[i] * (1 - amount)).toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase()
  );
}

export function buildThemeColors(accentId: AccentId, scheme: ColorScheme): ThemeColors {
  const n = NEUTRALS[scheme];
  const accentDef = ACCENTS.find((a) => a.id === accentId) ?? ACCENTS[0];
  const accent = scheme === 'light' ? accentDef.light : accentDef.dark;
  const s = STATUS[scheme];
  const softAmount = scheme === 'light' ? 0.12 : 0.14;
  return {
    ...n,
    accent,
    accentSoft: mix(accent, n.surface, 0.13),
    success: s.success,
    successSoft: mix(s.success, n.surface, softAmount),
    warning: s.warning,
    warningSoft: mix(s.warning, n.surface, softAmount),
    danger: s.danger,
    dangerSoft: mix(s.danger, n.surface, softAmount),
    ...STAGES[scheme],
  };
}

/**
 * ThemeColors key -> CSS variable. tailwind.config.js defines one color per
 * variable here, and global.css holds the Navy/light values for first paint.
 * Keep all three in step.
 */
const CSS_VARS: Record<keyof ThemeColors, string> = {
  canvas: '--canvas',
  surface: '--surface',
  surface2: '--surface-2',
  fill: '--fill',
  raised: '--raised',
  line: '--line',
  lineStrong: '--line-strong',
  hairline: '--hairline',
  ink: '--ink',
  ink2: '--ink-2',
  ink3: '--ink-3',
  accent: '--accent',
  accentSoft: '--accent-soft',
  onAccent: '--on-accent',
  success: '--success',
  successSoft: '--success-soft',
  warning: '--warning',
  warningSoft: '--warning-soft',
  danger: '--danger',
  dangerSoft: '--danger-soft',
  stageLearning: '--stage-learning',
  stageDaily: '--stage-daily',
  stageWeekly: '--stage-weekly',
  stageMonthly: '--stage-monthly',
};

/** Space-separated channels, the form `rgb(var(--x) / <alpha-value>)` needs. */
function cssVarValues(colors: ThemeColors): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(CSS_VARS) as (keyof ThemeColors)[]) {
    out[CSS_VARS[key]] = hexToRgb(colors[key]).join(' ');
  }
  return out;
}

// ============================================================
// Persistence
//
// Stored on the device, like the Memory Grid column count. App.tsx awaits
// loadStoredAccent() alongside the fonts, so the first frame is already in
// the chosen color instead of flashing navy.
// ============================================================
const ACCENT_STORAGE_KEY = 'ui.accent.v1';

export async function loadStoredAccent(): Promise<AccentId> {
  try {
    const raw = await AsyncStorage.getItem(ACCENT_STORAGE_KEY);
    return isAccentId(raw) ? raw : DEFAULT_ACCENT;
  } catch {
    return DEFAULT_ACCENT;
  }
}

interface ThemeContextValue {
  colors: ThemeColors;
  accentId: AccentId;
  setAccentId: (id: AccentId) => void;
  scheme: ColorScheme;
}

const ThemeContext = createContext<ThemeContextValue>({
  colors: buildThemeColors(DEFAULT_ACCENT, 'light'),
  accentId: DEFAULT_ACCENT,
  setAccentId: () => {},
  scheme: 'light',
});

export function ThemeProvider({ initialAccent, children }: { initialAccent: AccentId; children: React.ReactNode }) {
  const [accentId, setAccentState] = useState<AccentId>(initialAccent);
  // Light only for now. Dark values exist above; switching this is what
  // turning dark mode on will mean.
  const scheme: ColorScheme = 'light';

  const colors = useMemo(() => buildThemeColors(accentId, scheme), [accentId]);
  const cssValues = useMemo(() => cssVarValues(colors), [colors]);
  const rootVars = useMemo(() => vars(cssValues), [cssValues]);

  // On web, RN Modals portal outside this View, so they'd miss variables set
  // on it. Mirroring them onto <html> keeps those in the chosen accent too.
  // Native passes the variables through React context, which Modals keep.
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return;
    const root = document.documentElement;
    for (const [name, value] of Object.entries(cssValues)) root.style.setProperty(name, value);
  }, [cssValues]);

  const setAccentId = useCallback((id: AccentId) => {
    setAccentState(id);
    AsyncStorage.setItem(ACCENT_STORAGE_KEY, id).catch(() => {
      // Best-effort: the new accent already took effect for this session.
    });
  }, []);

  const value = useMemo(() => ({ colors, accentId, setAccentId, scheme }), [colors, accentId, setAccentId]);

  return (
    <ThemeContext.Provider value={value}>
      <View style={[{ flex: 1 }, rootVars]}>{children}</View>
    </ThemeContext.Provider>
  );
}

/** The palette as hex strings, for props that can't take a className. */
export function useThemeColors(): ThemeColors {
  return useContext(ThemeContext).colors;
}

/** The accent choice, for the Settings picker. */
export function useAccent() {
  const { accentId, setAccentId, scheme } = useContext(ThemeContext);
  return { accentId, setAccentId, scheme };
}
