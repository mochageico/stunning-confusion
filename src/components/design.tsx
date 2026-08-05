import React, { createContext, useContext, useSyncExternalStore } from 'react';
import { Pressable, Text, View, useWindowDimensions } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Check, ChevronDown, ChevronUp } from 'lucide-react-native';

// ============================================================================
// DESIGN SYSTEM
//
// The layout contract this app is held to, in one file. Three rules, and every
// primitive below exists to enforce one of them:
//
//   1. Text scales with the OS font-size setting, up to 1.5x, and layout grows
//      to fit it. Nothing clips.
//   2. No text sits below 11pt.
//   3. No container that holds text has a fixed height.
//
// Rule 3 is the one that caused the original iPhone SE leakage: cards pinned
// with `style={{ height: 92 }}` cannot grow when their text wraps to more
// lines, so the overflow is simply painted outside the card.
// ============================================================================

// ============================================================
// Font scaling
//
// We take MANUAL control of font scaling rather than letting React Native's
// built-in `allowFontScaling` do it. Reason: RN's automatic scaling multiplies
// `fontSize` but its handling of an explicit numeric `lineHeight` is
// inconsistent across platforms and versions. An unscaled lineHeight against a
// scaled fontSize is its own clipping bug -- lines overlap, descenders get cut.
//
// So every AppText below sets `allowFontScaling={false}` and computes BOTH
// fontSize and lineHeight from the scale itself. Deterministic, identical on
// iOS / Android / web, and it puts the 1.5x cap in exactly one place.
//
// The tradeoff: a plain <Text> that hasn't been migrated to <AppText> keeps
// RN's default behaviour. That's the migration boundary, screen by screen.
// ============================================================

/** Hard ceiling on text growth. Past this, layout stops being usable on a 375pt screen. */
export const MAX_FONT_SCALE = 1.5;

/**
 * Overrides the OS font scale. Used ONLY by the dev layout lab, so a single
 * machine can render every scale at once without touching system settings.
 * `null` means "use the real OS value".
 */
const FontScaleOverride = createContext<number | null>(null);

export function FontScaleOverrideProvider({ scale, children }: { scale: number; children: React.ReactNode }) {
  return <FontScaleOverride.Provider value={scale}>{children}</FontScaleOverride.Provider>;
}

/**
 * The scale to render at: the lab override if present, otherwise the real OS
 * setting, always clamped to [1, MAX_FONT_SCALE].
 *
 * useWindowDimensions (rather than PixelRatio.getFontScale()) because it
 * re-renders when the user changes the setting while the app is backgrounded.
 */
export function useFontScale(): number {
  const override = useContext(FontScaleOverride);
  const { fontScale } = useWindowDimensions();
  const raw = override ?? fontScale ?? 1;
  return Math.max(1, Math.min(MAX_FONT_SCALE, raw));
}

// ============================================================
// Type scale
//
// Replaces the ad-hoc `text-[8px]` / `text-[9px]` / `text-[10px]` bracket
// values that were carried over from the web build. Roles, not sizes, so a
// later visual redesign can retune the numbers in one place without touching
// call sites.
//
// 11pt is the floor. The old 8pt captions had zero headroom: at any scale
// above 1.0 they wrapped, and inside a fixed-height card that meant clipping.
// ============================================================
export const TYPE = {
  /** Smallest permitted text. Range ends, axis labels, unit hints. */
  micro: { fontSize: 11, lineHeight: 15 },
  /** Supporting copy under a label; the descriptive sentence on an option card. */
  caption: { fontSize: 12, lineHeight: 17 },
  /** Form-row labels, button text. */
  label: { fontSize: 13, lineHeight: 18 },
  /** Default reading size for prose. */
  body: { fontSize: 14, lineHeight: 20 },
  /** Uppercase tracked section headers. */
  section: { fontSize: 12, lineHeight: 16 },
  /** Card and option titles. */
  title: { fontSize: 16, lineHeight: 22 },
  /** Screen headings. */
  display: { fontSize: 22, lineHeight: 28 },
} as const;

export type TypeVariant = keyof typeof TYPE;

/**
 * Text with the scaling contract applied. Pass colour, weight, and font family
 * through `className` exactly as before -- this owns only fontSize/lineHeight,
 * so it drops into existing NativeWind styling without a rewrite.
 */
export function AppText({
  variant = 'body',
  className,
  style,
  children,
  ...rest
}: React.ComponentProps<typeof Text> & { variant?: TypeVariant }) {
  const scale = useFontScale();
  const { fontSize, lineHeight } = TYPE[variant];
  return (
    <Text
      allowFontScaling={false}
      className={className}
      style={[{ fontSize: fontSize * scale, lineHeight: lineHeight * scale }, style]}
      {...rest}
    >
      {children}
    </Text>
  );
}

// ============================================================
// Scaled space
//
// Padding and gaps around text need to grow with it, or a 1.5x label visually
// collides with the border of a card whose padding stayed at 14pt. Not applied
// to everything -- only where text is the thing being contained.
// ============================================================
export function useScaledSpace() {
  const scale = useFontScale();
  return (n: number) => Math.round(n * scale);
}

/**
 * Minimum comfortable touch target. Applied as minHeight (never height) so a
 * control containing scaled text still grows past it.
 */
export const MIN_TOUCH = 44;

// ============================================================
// Card — the bordered white panel used for every settings section.
// minHeight-free by construction: it grows to whatever its children need.
// ============================================================
export function Card({
  children,
  className = '',
  gap = 16,
}: {
  children: React.ReactNode;
  className?: string;
  gap?: number;
}) {
  const space = useScaledSpace();
  return (
    <View
      className={`border-2 border-[#1A1A1A] rounded-xl bg-white shadow-sm ${className}`}
      style={{ gap: space(gap), padding: space(14) }}
    >
      {children}
    </View>
  );
}

// ============================================================
// CollapsibleCard — a Card whose body can be folded away.
//
// DELIBERATELY NOT AN ACCORDION GROUP. Each card owns its own state under its
// own storage key, so any number can be open at once and opening one never
// closes another. Collapsing is an option for when a screen feels busy, not a
// mode the user is forced into — do not add exclusivity later.
//
// The open/closed choice persists, so a user who opens everything once doesn't
// have to re-assert that on every visit.
// ============================================================
const COLLAPSE_STORAGE_KEY = 'ui.collapsedSections.v1';

let collapseCache: Record<string, boolean> | null = null;
let collapseLoad: Promise<void> | null = null;
const collapseListeners = new Set<() => void>();

function notifyCollapse() {
  collapseListeners.forEach((l) => l());
}

function ensureCollapseLoaded() {
  if (collapseCache || collapseLoad) return;
  collapseLoad = AsyncStorage.getItem(COLLAPSE_STORAGE_KEY)
    .then((raw) => {
      collapseCache = raw ? JSON.parse(raw) : {};
    })
    .catch(() => {
      // A read failure just means we fall back to the per-card defaults.
      collapseCache = {};
    })
    .finally(notifyCollapse);
}

function subscribeCollapse(listener: () => void) {
  collapseListeners.add(listener);
  ensureCollapseLoaded();
  return () => {
    collapseListeners.delete(listener);
  };
}

/**
 * Persisted collapsed state for one section. Returns the stored value once
 * loaded, falling back to `defaultCollapsed` until then (and forever, if this
 * section has never been toggled).
 */
export function useCollapsed(storageKey: string, defaultCollapsed: boolean) {
  const collapsed = useSyncExternalStore(
    subscribeCollapse,
    () => (collapseCache && storageKey in collapseCache ? collapseCache[storageKey] : defaultCollapsed),
    () => defaultCollapsed
  );

  const setCollapsed = (next: boolean) => {
    if (!collapseCache) collapseCache = {};
    collapseCache[storageKey] = next;
    notifyCollapse();
    AsyncStorage.setItem(COLLAPSE_STORAGE_KEY, JSON.stringify(collapseCache)).catch(() => {
      // Persisting is best-effort; the in-memory value already took effect.
    });
  };

  return [collapsed, setCollapsed] as const;
}

export function CollapsibleCard({
  storageKey,
  title,
  summary,
  defaultCollapsed = false,
  children,
}: {
  /** Stable key for persistence. Unique per section. */
  storageKey: string;
  title: string;
  /** Current value shown on the header, so a collapsed section still tells you where it stands. */
  summary?: string;
  defaultCollapsed?: boolean;
  children: React.ReactNode;
}) {
  const [collapsed, setCollapsed] = useCollapsed(storageKey, defaultCollapsed);
  const scale = useFontScale();
  const space = useScaledSpace();
  const iconSize = Math.round(16 * scale);
  // Title and summary are two pieces of text in one row, which is the limit
  // before it becomes the pattern that broke. Past 1.3x they stack, same rule
  // as SettingRow, with the chevron staying put on the right.
  const stacked = scale >= 1.3;
  const Chevron = collapsed ? ChevronDown : ChevronUp;

  return (
    <View
      className="border-2 border-[#1A1A1A] rounded-xl bg-white shadow-sm"
      style={{ padding: space(14), gap: space(16) }}
    >
      <Pressable
        onPress={() => setCollapsed(!collapsed)}
        accessibilityRole="button"
        accessibilityState={{ expanded: !collapsed }}
        aria-expanded={!collapsed}
        className="flex-row items-center"
        style={{ minHeight: MIN_TOUCH, gap: space(8) }}
      >
        <View className={stacked ? 'flex-1' : 'flex-1 flex-row items-center'} style={{ gap: space(stacked ? 2 : 8) }}>
          <AppText
            variant="section"
            className={`font-sans font-extrabold uppercase tracking-widest text-[#1A1A1A] ${stacked ? '' : 'flex-1'}`}
          >
            {title}
          </AppText>
          {summary ? (
            <AppText variant="micro" className={`font-mono font-bold text-neutral-600 ${stacked ? '' : 'shrink-0'}`}>
              {summary}
            </AppText>
          ) : null}
        </View>
        <View className="shrink-0">
          <Chevron size={iconSize} color="#1A1A1A" />
        </View>
      </Pressable>
      {!collapsed && children}
    </View>
  );
}

/** Uppercase tracked header with a hairline rule under it. */
export function CardHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  const space = useScaledSpace();
  return (
    <View
      className="flex-row items-center justify-between border-b border-neutral-100"
      style={{ paddingBottom: space(8), gap: space(8) }}
    >
      <AppText
        variant="section"
        className="font-sans font-extrabold uppercase tracking-widest text-[#1A1A1A] flex-1"
      >
        {title}
      </AppText>
      {children}
    </View>
  );
}

// ============================================================
// SettingRow — a label on the left, a value badge on the right.
//
// The bug this replaces: `flex-row justify-between` with two plain Text
// children and no shrink permission. Text in React Native does not shrink
// below its intrinsic width unless told to, so at larger font scales the label
// pushed the value clean off the right edge of the screen.
//
// `flex-1` on the label (so it wraps instead of growing) plus `shrink-0` on the
// badge (so the number is never the thing that gets squeezed) fixes it. Above
// `stackAt`, the two stop sharing a line entirely.
// ============================================================
export function SettingRow({
  label,
  value,
  hint,
  stackAt = 1.3,
}: {
  label: string;
  value?: string | number;
  hint?: string;
  /** Font scale at which the label and value stop sharing a line. */
  stackAt?: number;
}) {
  const scale = useFontScale();
  const space = useScaledSpace();
  const stacked = scale >= stackAt;

  return (
    <View
      className={stacked ? '' : 'flex-row items-center justify-between'}
      style={{ gap: space(stacked ? 4 : 8) }}
    >
      <View className={stacked ? '' : 'flex-1'} style={{ gap: space(2) }}>
        <AppText variant="label" className="font-sans font-bold text-[#1A1A1A]">
          {label}
        </AppText>
        {hint ? (
          <AppText variant="micro" className="font-sans text-neutral-600">
            {hint}
          </AppText>
        ) : null}
      </View>
      {value !== undefined && (
        <View
          className={`bg-[#F3F2F1] border border-neutral-300 rounded shrink-0 ${stacked ? 'self-start' : ''}`}
          style={{ paddingHorizontal: space(8), paddingVertical: space(2) }}
        >
          <AppText variant="label" className="font-mono text-[#1A1A1A]">
            {value}
          </AppText>
        </View>
      )}
    </View>
  );
}

/**
 * The min/max captions under a stepper track.
 *
 * neutral-600, not neutral-400: these are 11pt mono at the bottom of the
 * contrast range, and 400-weight grey on white is the first thing to
 * disappear on a phone outdoors or for anyone whose eyes aren't 25.
 */
export function RangeCaption({ min, max }: { min: string; max: string }) {
  return (
    <View className="flex-row justify-between" style={{ gap: 8 }}>
      <AppText variant="micro" className="text-neutral-600 font-mono shrink">
        {min}
      </AppText>
      <AppText variant="micro" className="text-neutral-600 font-mono shrink text-right">
        {max}
      </AppText>
    </View>
  );
}

// ============================================================
// OptionCards — single-select from a small set, each option carrying a title
// and an explanatory sentence.
//
// Replaces an N-across `flex-row` of `flex-1` cards at a fixed 92pt height.
// On a 375pt screen, four columns left roughly 52pt of usable text width per
// card -- a title like "Grace at Your Discretion" needed five lines, and a
// 110-character description needed far more, inside a box that could not grow.
//
// Two layouts, chosen by font scale:
//
//   Below GRID_MAX_SCALE — a two-column grid of titles, with only the SELECTED
//   option's description shown beneath it. Roughly half the height of the list,
//   which matters: the app's compactness at default text size is something to
//   preserve, not spend. Two columns of ~150pt still give a long title like
//   "Grace at Your Discretion" room to wrap over two lines and grow.
//
//   At or above it — full-width stacked rows, every description always visible.
//   Two columns stop fitting well before 1.5x, and the descriptions are the part
//   that makes the setting comprehensible, so they get the whole content width.
//
// Both paths use minHeight, never height, so either can grow.
//
// NOTE: the shadow is unconditional, and only colours change with selection.
// Toggling shadow-* classes conditionally has caused a hard iOS freeze on the
// New Architecture, so selection state must never add or remove a shadow.
// ============================================================
export interface OptionCardItem<T extends string> {
  id: T;
  title: string;
  desc?: string;
}

/** Font scale at which the two-column grid gives way to the full-width list. */
const GRID_MAX_SCALE = 1.25;

const CARD_BASE = 'border-2 rounded-xl shadow-sm';
const cardTone = (active: boolean) =>
  active ? 'border-[#1A1A1A] bg-[#FBF9F6]' : 'border-[#E5E5E5] bg-white';

export function OptionCards<T extends string>({
  options,
  value,
  onChange,
}: {
  options: OptionCardItem<T>[];
  value: T;
  onChange: (id: T) => void;
}) {
  const scale = useFontScale();
  const space = useScaledSpace();
  // Icons take a numeric `size` prop rather than a style, so the scale is read
  // once here as a plain number -- never inside a map or conditional, where the
  // hook call count would vary with selection state.
  const checkSize = Math.round(12 * scale);

  if (scale < GRID_MAX_SCALE) {
    return <OptionGrid options={options} value={value} onChange={onChange} space={space} checkSize={checkSize} />;
  }
  return <OptionList options={options} value={value} onChange={onChange} space={space} checkSize={checkSize} />;
}

interface LayoutProps<T extends string> {
  options: OptionCardItem<T>[];
  value: T;
  onChange: (id: T) => void;
  space: (n: number) => number;
  checkSize: number;
}

/** Compact path: titles in a two-column grid, selected description below. */
function OptionGrid<T extends string>({ options, value, onChange, space, checkSize }: LayoutProps<T>) {
  // Chunked into explicit pairs rather than `flex-wrap` + percentage widths --
  // percentage basis plus a gap is where NativeWind/RN wrapping gets unreliable,
  // and pairs of `flex-1` children divide the row exactly.
  const rows: OptionCardItem<T>[][] = [];
  for (let i = 0; i < options.length; i += 2) rows.push(options.slice(i, i + 2));

  const selected = options.find((o) => o.id === value);

  return (
    <View style={{ gap: space(8) }}>
      {rows.map((row, rowIndex) => (
        <View key={rowIndex} className="flex-row" style={{ gap: space(8) }}>
          {row.map((opt) => {
            const active = opt.id === value;
            return (
              <Pressable
                key={opt.id}
                onPress={() => onChange(opt.id)}
                accessibilityRole="radio"
                // `checked` (not `selected`) is the correct state for a radio,
                // and the explicit aria-* prop is needed because React Native
                // Web drops accessibilityState on Pressable entirely.
                accessibilityState={{ checked: active }}
                aria-checked={active}
                className={`flex-1 flex-row items-start ${CARD_BASE} ${cardTone(active)}`}
                style={{ minHeight: MIN_TOUCH, padding: space(8), gap: space(6) }}
              >
                <AppText variant="label" className="font-serif font-black text-[#1A1A1A] flex-1">
                  {opt.title}
                </AppText>
                {/* Reserved whether or not selected, so selecting never reflows
                    the title beside it. */}
                <View className="items-center justify-center shrink-0" style={{ width: space(14), height: space(14) }}>
                  {active && (
                    <View
                      className="rounded-full bg-[#1A1A1A] items-center justify-center"
                      style={{ width: space(14), height: space(14) }}
                    >
                      <Check size={checkSize} color="#FFFFFF" strokeWidth={3} />
                    </View>
                  )}
                </View>
              </Pressable>
            );
          })}
          {/* Keeps a trailing odd card at half width instead of letting it
              stretch across the row and read as a different kind of control. */}
          {row.length === 1 && <View className="flex-1" />}
        </View>
      ))}

      {selected?.desc ? (
        <View
          className="border border-[#E5E5E5] rounded-xl bg-[#FBF9F6]"
          style={{ padding: space(8) }}
        >
          <AppText variant="caption" className="font-sans text-neutral-600">
            {selected.desc}
          </AppText>
        </View>
      ) : null}
    </View>
  );
}

/** Roomy path: full-width rows, every description visible. */
function OptionList<T extends string>({ options, value, onChange, space, checkSize }: LayoutProps<T>) {
  return (
    <View style={{ gap: space(8) }}>
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <Pressable
            key={opt.id}
            onPress={() => onChange(opt.id)}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            aria-checked={active}
            className={`flex-row items-start ${CARD_BASE} ${cardTone(active)}`}
            style={{ minHeight: MIN_TOUCH, padding: space(10), gap: space(10) }}
          >
            <View className="flex-1" style={{ gap: space(3) }}>
              <AppText variant="title" className="font-serif font-black text-[#1A1A1A]">
                {opt.title}
              </AppText>
              {opt.desc ? (
                <AppText variant="caption" className="font-sans text-neutral-600">
                  {opt.desc}
                </AppText>
              ) : null}
            </View>
            <View className="items-center justify-center shrink-0" style={{ width: space(20), height: space(20) }}>
              {active && (
                <View
                  className="rounded-full bg-[#1A1A1A] items-center justify-center"
                  style={{ width: space(20), height: space(20) }}
                >
                  <Check size={checkSize} color="#FFFFFF" strokeWidth={3} />
                </View>
              )}
            </View>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * Toggle switch with a shrinkable label block beside it. Same shrink discipline
 * as SettingRow: the switch is fixed-size and never squeezed, the text wraps.
 */
export function ToggleRow({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  const space = useScaledSpace();
  return (
    <View className="flex-row items-center justify-between" style={{ gap: space(10) }}>
      <View className="flex-1" style={{ gap: space(2) }}>
        <AppText variant="label" className="font-sans font-bold text-neutral-800">
          {label}
        </AppText>
        {hint ? (
          <AppText variant="micro" className="font-sans text-neutral-600">
            {hint}
          </AppText>
        ) : null}
      </View>
      <Pressable
        onPress={() => onChange(!value)}
        accessibilityRole="switch"
        accessibilityState={{ checked: value }}
        aria-checked={value}
        className={`rounded-full justify-center shrink-0 ${value ? 'bg-[#1A1A1A]' : 'bg-neutral-200'}`}
        // layout-ok: the switch holds no text, so a fixed size is correct here.
        style={{ width: 40, height: 24, paddingHorizontal: 2 }}
      >
        <View className="w-5 h-5 rounded-full bg-white shadow" style={{ transform: [{ translateX: value ? 16 : 0 }] }} />
      </Pressable>
    </View>
  );
}
