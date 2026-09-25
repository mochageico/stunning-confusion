import React, { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import { Pressable, Text, TextInput, View, useWindowDimensions } from 'react-native';
import type { TextStyle, ViewStyle } from 'react-native';
import {
  Inter_400Regular,
  Inter_400Regular_Italic,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
} from '@expo-google-fonts/inter';
import {
  Literata_400Regular,
  Literata_400Regular_Italic,
  Literata_500Medium,
  Literata_600SemiBold,
  Literata_700Bold,
} from '@expo-google-fonts/literata';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Check, ChevronDown, ChevronUp } from 'lucide-react-native';

import { useThemeColors } from './theme';
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
//
// The sizes are the iPhone's own text styles (job F2): body is 17pt like
// every Apple app, up from 14. Small roles grew less than body did, so dense
// rows stay dense. The name after each is the iOS style it matches.
// ============================================================
export const TYPE = {
  /** Smallest text used. Range ends, axis labels, unit hints, small pills. iOS Caption 1. */
  micro: { fontSize: 12, lineHeight: 16 },
  /** Supporting copy under a label; the descriptive sentence on an option card. iOS Footnote. */
  caption: { fontSize: 13, lineHeight: 18 },
  /** Form-row labels, button text. iOS Subheadline. */
  label: { fontSize: 15, lineHeight: 20 },
  /** Default reading size for prose. iOS Body. */
  body: { fontSize: 17, lineHeight: 22 },
  /** Section headers above a group. iOS Footnote. */
  section: { fontSize: 13, lineHeight: 18 },
  /** Card and option titles. iOS Title 3. */
  title: { fontSize: 20, lineHeight: 25 },
  /** Screen headings. iOS Title 1. */
  display: { fontSize: 28, lineHeight: 34 },
} as const;

export type TypeVariant = keyof typeof TYPE;

// ============================================================
// Font faces
//
// On iOS a weight class does nothing to a custom font. expo-font registers
// `Inter_400Regular` as a family with exactly one face, so `fontWeight: 'bold'`
// picks the closest weight from a one-item list -- Regular. Android and web
// fake a bold instead. Either way the weight has to come from the font FILE.
//
// So AppText / AppTextInput read the family, weight and italic tokens out of
// `className`, pick the real face, and set it in `style` (style beats
// className). fontWeight/fontStyle go back to 'normal' so nothing can fake a
// second bold or slant on top of a face that already has it.
//
//   font-sans / none -> Inter
//   font-serif       -> Literata, lining digits (so chapter and calendar
//                       numbers sit on the baseline instead of bouncing)
//   font-mono        -> Inter with tabular digits. Courier is retired; the
//                       class now means "numbers that line up".
//
// Only the faces in APP_FONTS exist. extrabold/black map to Bold, light/thin
// to Regular, and italic always uses the 400 italic face.
// ============================================================

/** Every face the app loads. App.tsx hands this straight to useFonts. */
export const APP_FONTS = {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_400Regular_Italic,
  Literata_400Regular,
  Literata_500Medium,
  Literata_600SemiBold,
  Literata_700Bold,
  Literata_400Regular_Italic,
};

type FontFamilyRole = 'sans' | 'serif' | 'mono';
type FontWeightStep = 400 | 500 | 600 | 700;
interface FontSpec {
  family: FontFamilyRole;
  weight: FontWeightStep;
  italic: boolean;
}

// When a className carries two family tokens (a few conditional strings do),
// the one later in Tailwind's generated stylesheet wins, not the one later in
// the string. The ranks copy that order so the face matches what the class
// used to mean.
const FAMILY_TOKENS: Record<string, { family: FontFamilyRole; rank: number }> = {
  'font-sans': { family: 'sans', rank: 0 },
  'font-serif': { family: 'serif', rank: 1 },
  'font-mono': { family: 'mono', rank: 2 },
};
const WEIGHT_TOKENS: Record<string, { weight: FontWeightStep; rank: number }> = {
  'font-thin': { weight: 400, rank: 0 },
  'font-extralight': { weight: 400, rank: 1 },
  'font-light': { weight: 400, rank: 2 },
  'font-normal': { weight: 400, rank: 3 },
  'font-medium': { weight: 500, rank: 4 },
  'font-semibold': { weight: 600, rank: 5 },
  'font-bold': { weight: 700, rank: 6 },
  'font-extrabold': { weight: 700, rank: 7 },
  'font-black': { weight: 700, rank: 8 },
};
const WEIGHT_SUFFIX: Record<FontWeightStep, string> = {
  400: '400Regular',
  500: '500Medium',
  600: '600SemiBold',
  700: '700Bold',
};

const parsedFontTokens = new Map<string, Partial<FontSpec>>();

/** The font tokens a className sets itself. Cached: className strings repeat. */
function parseFontTokens(className: string | undefined): Partial<FontSpec> {
  if (!className) return {};
  const cached = parsedFontTokens.get(className);
  if (cached) return cached;
  const spec: Partial<FontSpec> = {};
  let familyRank = -1;
  let weightRank = -1;
  for (const token of className.split(/\s+/)) {
    const fam = FAMILY_TOKENS[token];
    if (fam && fam.rank > familyRank) {
      spec.family = fam.family;
      familyRank = fam.rank;
    }
    const w = WEIGHT_TOKENS[token];
    if (w && w.rank > weightRank) {
      spec.weight = w.weight;
      weightRank = w.rank;
    }
    // `not-italic` follows `italic` in the stylesheet, so it wins a tie.
    if (token === 'italic' && spec.italic === undefined) spec.italic = true;
    if (token === 'not-italic') spec.italic = false;
  }
  parsedFontTokens.set(className, spec);
  return spec;
}

/**
 * What a nested AppText inherits. RN text inherits font attributes from its
 * parent Text, so a bold word inside a serif verse should stay serif. Because
 * the face is now one explicit fontFamily, that inheritance has to be done
 * here -- a nested AppText fills whatever tokens it lacks from its parent.
 */
const InheritedFont = createContext<FontSpec | null>(null);

function resolveFont(className: string | undefined, parent: FontSpec | null): FontSpec {
  const own = parseFontTokens(className);
  return {
    family: own.family ?? parent?.family ?? 'sans',
    weight: own.weight ?? parent?.weight ?? 400,
    italic: own.italic ?? parent?.italic ?? false,
  };
}

function fontStyleFor({ family, weight, italic }: FontSpec): TextStyle {
  const base = family === 'serif' ? 'Literata' : 'Inter';
  return {
    fontFamily: italic ? `${base}_400Regular_Italic` : `${base}_${WEIGHT_SUFFIX[weight]}`,
    fontWeight: 'normal',
    fontStyle: 'normal',
    ...(family === 'mono' ? { fontVariant: ['tabular-nums'] } : family === 'serif' ? { fontVariant: ['lining-nums'] } : null),
  };
}

/**
 * Text with the scaling contract applied. Pass colour, weight, and font family
 * through `className` as before: the family/weight/italic classes are turned
 * into the real font face (see "Font faces" above), everything else passes
 * through untouched.
 *
 * `variant="inherit"` sets no size. Use it for a word or phrase nested inside
 * another AppText that should match its paragraph (graded words in Recall, a
 * bold name in a sentence), or for text sized by its own `style`.
 */
export function AppText({
  variant = 'body',
  className,
  style,
  children,
  ...rest
}: React.ComponentProps<typeof Text> & { variant?: TypeVariant | 'inherit' }) {
  const scale = useFontScale();
  const parentFont = useContext(InheritedFont);
  const font = resolveFont(className, parentFont);
  const { family, weight, italic } = font;
  const inherited = useMemo<FontSpec>(() => ({ family, weight, italic }), [family, weight, italic]);
  const size =
    variant === 'inherit'
      ? null
      : { fontSize: TYPE[variant].fontSize * scale, lineHeight: TYPE[variant].lineHeight * scale };
  const text = (
    <Text allowFontScaling={false} className={className} style={[fontStyleFor(font), size, style]} {...rest}>
      {children}
    </Text>
  );
  // Plain strings have no nested AppText to inherit anything.
  if (typeof children === 'string' || typeof children === 'number') return text;
  return <InheritedFont.Provider value={inherited}>{text}</InheritedFont.Provider>;
}

/**
 * The same scaling contract, and the same className -> font face mapping, for
 * text entry. `AppText` can't be used here --
 * `TextInput` is a different component, not a `Text` with an `editable` prop --
 * which is why inputs were the one thing left on raw `text-xs` after the type
 * migration.
 *
 * Defaults to `label` because that's what the migration turned `text-xs` into,
 * and 31 of the app's inputs were `text-xs`. The 15 that carried no size class
 * at all were rendering at the platform default, which differed per platform;
 * they now match everything else.
 *
 * The lineHeight asymmetry is deliberate and is the whole reason this isn't a
 * two-line wrapper: an explicit lineHeight on a SINGLE-LINE TextInput
 * mis-centres the text vertically and clips descenders on Android, so it is
 * applied only when `multiline` is set -- where it genuinely helps, because
 * that's the case that actually wraps.
 */
export function AppTextInput({
  variant = 'label',
  className,
  style,
  ...rest
}: React.ComponentProps<typeof TextInput> & { variant?: TypeVariant }) {
  const scale = useFontScale();
  const palette = useThemeColors();
  const { fontSize, lineHeight } = TYPE[variant];
  return (
    <TextInput
      allowFontScaling={false}
      // ink-3 unless the call site picks one: the platform default is too faint.
      placeholderTextColor={palette.ink3}
      className={className}
      style={[
        fontStyleFor(resolveFont(className, null)),
        { fontSize: fontSize * scale },
        rest.multiline ? { lineHeight: lineHeight * scale } : null,
        style,
      ]}
      {...rest}
    />
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
// Buttons
//
// Three sizes, because the app had eleven: py-0.5 / 1 / 1.5 / 2 / 2.5 / 3 /
// 3.5 plus fixed h-5 / h-7 / h-8 / h-9 / h-12, chosen ad hoc per call site.
//
// The fixed heights were the actual bug, not just the inconsistency. `h-8` on
// a button containing text breaks rule 3 at the top of this file: at 1.5x the
// label has nowhere to grow, so it clips -- the same failure as the original
// SE card leakage, in a smaller box. Every size below is a minHeight.
//
// `sm` sits deliberately below MIN_TOUCH. It is for a secondary affordance
// inside an already-tappable row (the Listen/Review pills on a due-review
// row), where a 44pt control would dominate the row it belongs to. Those get
// `hitSlop` instead, which is the honest fix for a small target: the visual
// stays small, the tappable area doesn't.
// ============================================================
export type ButtonSize = 'sm' | 'md' | 'lg';

export const BUTTON_SIZE: Record<
  ButtonSize,
  { minHeight: number; py: number; px: number; gap: number; type: TypeVariant; icon: number; hitSlop: number }
> = {
  /** Inline pills and row actions. Below MIN_TOUCH by design -- see above. */
  sm: { minHeight: 28, py: 4, px: 10, gap: 4, type: 'micro', icon: 12, hitSlop: 8 },
  /** The default. Toolbar buttons, sheet actions, anything standalone. */
  md: { minHeight: MIN_TOUCH, py: 8, px: 14, gap: 6, type: 'label', icon: 15, hitSlop: 0 },
  /** Full-width primary actions -- the one obvious thing to do on a screen. */
  lg: { minHeight: 52, py: 12, px: 18, gap: 8, type: 'label', icon: 17, hitSlop: 0 },
};

/**
 * A circular icon-only control: back, close, send, play.
 *
 * A FIXED width/height is correct here and is not a rule-3 violation, because
 * the thing being contained is an icon, not text -- there is no label that can
 * wrap and overflow. What was actually wrong with these is subtler:
 *
 *   - 32pt (`w-8 h-8`, 21 of the app's back buttons) is well under MIN_TOUCH.
 *   - The circle didn't scale, so at 1.5x every header grew around a back
 *     button that stayed exactly the same size.
 *
 * Both are fixed without making headers bulkier: the circle scales with the
 * font setting, and `hitSlop` makes up whatever is still missing to reach
 * MIN_TOUCH. The visual stays as small as the design wants; the tap target
 * doesn't.
 *
 * Always round (job F3). `variant` picks the look:
 *   outline  card-colored circle with a thin edge, ink-2 icon (close, clip,
 *            the icon buttons in a header)
 *   filled   accent circle, on-accent icon (send, play)
 *   bare     no circle, accent icon (an icon sitting in a row)
 * Leaving `variant` out keeps the old behaviour, where className supplies
 * the colors, so existing call sites are unchanged until their S job.
 */
export type IconButtonVariant = 'outline' | 'filled' | 'bare';

const ICON_BUTTON_LOOK: Record<IconButtonVariant, string> = {
  outline: 'bg-surface border border-line active:bg-surface-2',
  filled: 'bg-accent active:opacity-80',
  bare: 'active:opacity-60',
};

export function AppIconButton({
  Icon,
  variant,
  diameter = variant ? 36 : 32,
  iconSize,
  iconColor,
  className = '',
  style,
  disabled,
  ...rest
}: Omit<React.ComponentProps<typeof Pressable>, 'style' | 'children'> & {
  Icon: React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;
  variant?: IconButtonVariant;
  /** Unscaled circle size. The app's conventions: 28 close, 32 back, 36 send. */
  diameter?: number;
  /** Unscaled icon size. Defaults to a proportion that reads well at every diameter. */
  iconSize?: number;
  iconColor?: string;
  style?: ViewStyle;
}) {
  const palette = useThemeColors();
  const scale = useFontScale();
  const d = Math.round(diameter * scale);
  // Whatever the circle still lacks to be comfortably tappable, spread evenly.
  const slop = Math.max(0, Math.round((MIN_TOUCH - d) / 2));
  const defaultColor =
    variant === 'filled' ? palette.onAccent : variant === 'bare' ? palette.accent : variant === 'outline' ? palette.ink2 : palette.ink;
  return (
    <Pressable
      className={`items-center justify-center rounded-full ${variant ? ICON_BUTTON_LOOK[variant] : ''} ${className}`}
      hitSlop={slop || undefined}
      disabled={disabled}
      accessibilityRole="button"
      style={[{ width: d, height: d }, disabled ? { opacity: 0.4 } : null, style]}
      {...rest}
    >
      <Icon
        size={Math.round((iconSize ?? Math.round(diameter * (variant ? 0.5 : 0.44))) * scale)}
        color={iconColor ?? defaultColor}
        {...(variant ? { strokeWidth: 2.2 } : null)}
      />
    </Pressable>
  );
}

/**
 * A button that grows with its text instead of clipping it.
 *
 * `variant` is the look (job F3). Use it for every new button:
 *
 *   primary      accent fill, on-accent text. The one main action on a screen.
 *   secondary    accent-soft fill, accent text. A second action beside it.
 *   quiet        outlined, ink-2 text. Cancel, Start over, anything minor.
 *   destructive  danger-soft fill, danger text. Delete, Leave, Remove.
 *
 * Labels are sentence case ("Add to My Verses"), never all caps, and
 * semibold. Leaving `variant` out keeps the older behaviour, where className
 * and textClassName carry the colors; the S jobs move those call sites over.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'quiet' | 'destructive';

const BUTTON_LOOK: Record<ButtonVariant, { box: string; text: string }> = {
  primary: { box: 'bg-accent active:opacity-80', text: 'text-on-accent' },
  secondary: { box: 'bg-accent-soft active:opacity-80', text: 'text-accent' },
  quiet: { box: 'border border-line-strong active:bg-surface-2', text: 'text-ink-2' },
  destructive: { box: 'bg-danger-soft active:opacity-80', text: 'text-danger' },
};

export function AppButton({
  size = 'md',
  variant,
  label,
  Icon,
  className = '',
  textClassName = '',
  iconColor,
  style,
  disabled,
  children,
  ...rest
}: Omit<React.ComponentProps<typeof Pressable>, 'style' | 'children'> & {
  // Pressable allows a state callback for both of these; this doesn't. A
  // button whose geometry depends on press state would defeat the point of a
  // fixed set of sizes, and no call site in the app does it.
  style?: ViewStyle;
  children?: React.ReactNode;
  size?: ButtonSize;
  variant?: ButtonVariant;
  label?: string;
  Icon?: React.ComponentType<{ size?: number; color?: string }>;
  textClassName?: string;
  iconColor?: string;
}) {
  const palette = useThemeColors();
  const scale = useFontScale();
  const s = BUTTON_SIZE[size];
  const look = variant ? BUTTON_LOOK[variant] : null;
  const defaultIconColor = !variant
    ? palette.onAccent
    : variant === 'primary'
      ? palette.onAccent
      : variant === 'secondary'
        ? palette.accent
        : variant === 'destructive'
          ? palette.danger
          : palette.ink2;
  // Bold (semibold with a variant) unless textClassName picks its own weight:
  // two weight classes don't combine, the heavier one always wins.
  const ownWeight = /\bfont-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)\b/.test(textClassName);
  const weight = ownWeight ? '' : look ? 'font-semibold' : 'font-bold';
  return (
    <Pressable
      className={`flex-row items-center justify-center ${look ? `rounded-btn ${look.box}` : ''} ${className}`}
      hitSlop={s.hitSlop || undefined}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={disabled ? { disabled: true } : undefined}
      style={[
        {
          minHeight: Math.round(s.minHeight * scale),
          paddingVertical: Math.round(s.py * scale),
          paddingHorizontal: Math.round(s.px * scale),
          gap: Math.round(s.gap * scale),
        },
        // Only a variant button dims itself: older call sites style their own
        // disabled look, and dimming on top of that would double it.
        look && disabled ? { opacity: 0.45 } : null,
        style,
      ]}
      {...rest}
    >
      {Icon ? <Icon size={Math.round(s.icon * scale)} color={iconColor ?? defaultIconColor} /> : null}
      {label ? (
        <AppText
          variant={s.type}
          className={`font-sans ${weight} ${look ? look.text : ''} ${textClassName}`}
          numberOfLines={look ? 2 : 1}
          style={look ? { textAlign: 'center', flexShrink: 1 } : undefined}
        >
          {label}
        </AppText>
      ) : null}
      {children}
    </Pressable>
  );
}

// ============================================================
// Card — the off-white panel with a thin edge. No shadow: in this look only
// the floating bars cast one.
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
      className={`border border-line rounded-card bg-surface ${className}`}
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
  accessory,
  children,
}: {
  /** Stable key for persistence. Unique per section. */
  storageKey: string;
  title: string;
  /** Drawn right after the title, e.g. a HelpTooltip, so a "?" never sits alone on its own row. */
  accessory?: React.ReactNode;
  /** Current value shown on the header, so a collapsed section still tells you where it stands. */
  summary?: string;
  defaultCollapsed?: boolean;
  children: React.ReactNode;
}) {
  const palette = useThemeColors();
  const [collapsed, setCollapsed] = useCollapsed(storageKey, defaultCollapsed);
  const scale = useFontScale();
  const space = useScaledSpace();
  const iconSize = Math.round(18 * scale);
  // Title and summary are two pieces of text in one row, which is the limit
  // before it becomes the pattern that broke. Past 1.3x they stack, same rule
  // as SettingRow, with the chevron staying put on the right.
  const stacked = scale >= 1.3;
  const Chevron = collapsed ? ChevronDown : ChevronUp;

  return (
    <View className="border border-line rounded-card bg-surface" style={{ paddingHorizontal: space(14), paddingBottom: collapsed ? 0 : space(14) }}>
      <Pressable
        onPress={() => setCollapsed(!collapsed)}
        accessibilityRole="button"
        accessibilityState={{ expanded: !collapsed }}
        aria-expanded={!collapsed}
        className="flex-row items-center"
        style={{ minHeight: Math.round(52 * scale), paddingVertical: space(8), gap: space(8) }}
      >
        <View className={stacked ? 'flex-1' : 'flex-1 flex-row items-center'} style={{ gap: space(stacked ? 2 : 8) }}>
          <View className={`flex-row items-center ${stacked ? '' : 'flex-1'}`} style={{ gap: space(6) }}>
            <AppText variant="body" className="font-sans font-semibold text-ink shrink">
              {title}
            </AppText>
            {accessory}
          </View>
          {summary ? (
            <AppText variant="label" className={`font-sans text-ink-3 ${stacked ? '' : 'shrink-0'}`}>
              {summary}
            </AppText>
          ) : null}
        </View>
        <View className="shrink-0">
          <Chevron size={iconSize} color={palette.ink3} strokeWidth={2.4} />
        </View>
      </Pressable>
      {!collapsed && <View style={{ gap: space(16), paddingTop: space(4) }}>{children}</View>}
    </View>
  );
}

/** A card's title row: the title on the left, anything else (a count, a
 *  small button) on the right, with a hairline under it. Sentence case. */
export function CardHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  const space = useScaledSpace();
  return (
    <View
      className="flex-row items-center justify-between border-b border-hairline"
      style={{ paddingBottom: space(8), gap: space(8) }}
    >
      <AppText variant="body" className="font-sans font-semibold text-ink flex-1">
        {title}
      </AppText>
      {children}
    </View>
  );
}

// ============================================================
// SettingRow — a label on the left, its value on the right.
//
// The bug this replaces: `flex-row justify-between` with two plain Text
// children and no shrink permission. Text in React Native does not shrink
// below its intrinsic width unless told to, so at larger font scales the label
// pushed the value clean off the right edge of the screen.
//
// `flex-1` on the label (so it wraps instead of growing) plus `shrink-0` on the
// value (so the number is never the thing that gets squeezed) fixes it. Above
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
        <AppText variant="body" className="font-sans text-ink">
          {label}
        </AppText>
        {hint ? (
          <AppText variant="caption" className="font-sans text-ink-2">
            {hint}
          </AppText>
        ) : null}
      </View>
      {/* The value reads as plain text in ink-3, the way a grouped iPhone
          list shows one, instead of sitting in a bordered badge. */}
      {value !== undefined && (
        <AppText variant="body" className={`font-mono text-ink-3 shrink-0 ${stacked ? '' : 'text-right'}`}>
          {value}
        </AppText>
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
      <AppText variant="micro" className="text-ink-2 font-sans shrink">
        {min}
      </AppText>
      <AppText variant="micro" className="text-ink-2 font-sans shrink text-right">
        {max}
      </AppText>
    </View>
  );
}

// ============================================================
// ChoiceCard — the one "pick one" pattern (job F3).
//
// The app had seven: ChipRow flex-1, ChipRow wrap, the grey-tray segmented
// control, day circles, OptionCards with a check on the right, radio-left
// cards, and empty-circle toggles. For choices that need a sentence of
// explanation this is the only one now: a card with the title, an optional
// description, and a radio mark on the right. Short labels with no
// explanation use SegmentedControl (blocks.tsx) instead.
//
// Selection changes colors and the mark only. No shadow, so nothing about a
// shadow can change with selection (see the iOS Fabric note on OptionCards).
// ============================================================
export function ChoiceCard({
  title,
  description,
  selected,
  onPress,
  compact = false,
  className = '',
}: {
  title: string;
  description?: string;
  selected: boolean;
  onPress: () => void;
  /** Tighter padding and a smaller title, for two-across grids. */
  compact?: boolean;
  className?: string;
}) {
  const space = useScaledSpace();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      // `checked` (not `selected`) is the correct state for a radio, and the
      // explicit aria-* prop is needed because React Native Web drops
      // accessibilityState on Pressable entirely.
      accessibilityState={{ checked: selected }}
      aria-checked={selected}
      className={`flex-row items-start border rounded-card ${
        selected ? 'border-accent bg-accent-soft' : 'border-line bg-surface active:bg-surface-2'
      } ${className}`}
      style={{ minHeight: MIN_TOUCH, padding: space(compact ? 10 : 14), gap: space(10) }}
    >
      <View className="flex-1" style={{ gap: space(2) }}>
        <AppText variant={compact ? 'label' : 'body'} className="font-sans font-semibold text-ink">
          {title}
        </AppText>
        {description ? (
          <AppText variant="caption" className="font-sans text-ink-2">
            {description}
          </AppText>
        ) : null}
      </View>
      <RadioMark selected={selected} size={compact ? 18 : 22} />
    </Pressable>
  );
}

/** The radio circle on a ChoiceCard: an empty ring, or an accent disc with a check. */
export function RadioMark({ selected, size = 22 }: { selected: boolean; size?: number }) {
  const palette = useThemeColors();
  const scale = useFontScale();
  const d = Math.round(size * scale);
  return (
    <View
      // Reserved at the same size either way, so selecting never reflows the
      // title beside it.
      className={`rounded-full items-center justify-center shrink-0 ${selected ? 'bg-accent' : 'border-2 border-line-strong'}`}
      style={{ width: d, height: d, marginTop: Math.round(1 * scale) }}
    >
      {selected ? <Check size={Math.round(size * 0.62 * scale)} color={palette.onAccent} strokeWidth={3} /> : null}
    </View>
  );
}

// ============================================================
// OptionCards — single-select from a small set, each option carrying a title
// and an explanatory sentence. Built from ChoiceCard.
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
//   At or above it — full-width stacked cards, every description always
//   visible. Two columns stop fitting well before 1.5x, and the descriptions
//   are the part that makes the setting comprehensible, so they get the whole
//   content width.
//
// Both paths use minHeight, never height, so either can grow.
//
// NOTE: never give these a shadow that changes with selection. Toggling
// shadow-* classes conditionally has caused a hard iOS freeze on the New
// Architecture, so selection state must never add or remove a shadow.
// ============================================================
export interface OptionCardItem<T extends string> {
  id: T;
  title: string;
  desc?: string;
}

/** Font scale at which the two-column grid gives way to the full-width list. */
const GRID_MAX_SCALE = 1.25;

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

  if (scale >= GRID_MAX_SCALE) {
    return (
      <View style={{ gap: space(8) }}>
        {options.map((opt) => (
          <ChoiceCard
            key={opt.id}
            title={opt.title}
            description={opt.desc}
            selected={opt.id === value}
            onPress={() => onChange(opt.id)}
          />
        ))}
      </View>
    );
  }

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
          {row.map((opt) => (
            <ChoiceCard
              key={opt.id}
              compact
              className="flex-1"
              title={opt.title}
              selected={opt.id === value}
              onPress={() => onChange(opt.id)}
            />
          ))}
          {/* Keeps a trailing odd card at half width instead of letting it
              stretch across the row and read as a different kind of control. */}
          {row.length === 1 && <View className="flex-1" />}
        </View>
      ))}

      {selected?.desc ? (
        <AppText variant="caption" className="font-sans text-ink-2" style={{ paddingHorizontal: space(4) }}>
          {selected.desc}
        </AppText>
      ) : null}
    </View>
  );
}

// ============================================================
// Switch — the iPhone's on/off control, drawn in Views (no native module).
//
// Fixed size on purpose, as on the iPhone: it holds no text, so it has nothing
// to grow for. The knob's shadow is always on; only the track color and the
// knob's position change.
// ============================================================
export function Switch({
  value,
  onChange,
  disabled,
  accessibilityLabel,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
  disabled?: boolean;
  accessibilityLabel?: string;
}) {
  return (
    <Pressable
      onPress={() => onChange(!value)}
      disabled={disabled}
      hitSlop={8}
      accessibilityRole="switch"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ checked: value, disabled }}
      aria-checked={value}
      className={`rounded-full justify-center shrink-0 ${value ? 'bg-accent' : 'bg-fill'}`}
      // layout-ok: the switch holds no text, so a fixed size is correct here.
      style={{ width: 51, height: 31, paddingHorizontal: 2, opacity: disabled ? 0.45 : 1 }}
    >
      {/* White in both schemes, as on the iPhone. */}
      <View
        className="rounded-full bg-white shadow-sm"
        // layout-ok: the knob holds no text.
        style={{ width: 27, height: 27, transform: [{ translateX: value ? 20 : 0 }] }}
      />
    </Pressable>
  );
}

/**
 * A label (and optional hint) with a Switch beside it. Same shrink discipline
 * as SettingRow: the switch is fixed-size and never squeezed, the text wraps.
 * Inside a GroupedList, use a ListRow with `accessory={<Switch />}` instead.
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
        <AppText variant="body" className="font-sans text-ink">
          {label}
        </AppText>
        {hint ? (
          <AppText variant="caption" className="font-sans text-ink-2">
            {hint}
          </AppText>
        ) : null}
      </View>
      <Switch value={value} onChange={onChange} accessibilityLabel={label} />
    </View>
  );
}
