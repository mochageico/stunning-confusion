import React, { createContext, useContext } from 'react';
import { Image, Modal, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, ChevronRight, X } from 'lucide-react-native';

import { AppButton, AppIconButton, AppText, MIN_TOUCH, useFontScale, useScaledSpace } from './design';
import { useThemeColors } from './theme';

// ============================================================================
// BUILDING BLOCKS (job F3)
//
// The shared parts every screen is built from, so the S jobs assemble screens
// instead of restyling each one by hand. design.tsx keeps the primitives
// (text, buttons, cards, ChoiceCard, Switch); this file holds the larger
// pieces. Import order is design -> blocks -> ui, never the other way.
//
//   ScreenHeader      back link, large title, optional eyebrow/subtitle/actions
//   SectionHeader     the small grey label above a group
//   GroupedList       a card of rows with inset dividers
//   ListRow           one row: icon, title, value, chevron or accessory
//   SegmentedControl  2-5 short, mutually exclusive labels
//   Badge             a small status pill
//   Avatar            a person's photo or initial
//   EmptyState        what an empty list says, and what to do about it
//   Dialog            the one overlay: a centered dialog or a bottom sheet
//
// The "pick one with an explanation" card is ChoiceCard (design.tsx).
// Rules for all of them: colors from tokens only, sentence case, minHeight
// never height, and no shadow that changes with state.
// ============================================================================

type IconType = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

// ============================================================
// ScreenHeader
//
// The six header variants become one. Default is the iPhone's large-title
// layout: a row with the back link (chevron plus where it goes, in the
// accent) and any actions, then the title in bold sans below it. `inline`
// puts a smaller title in the same row as the back button, for chat threads
// and full-screen tools where vertical room matters more.
// ============================================================
export function ScreenHeader({
  title,
  onBack,
  backLabel = 'Back',
  eyebrow,
  subtitle,
  actions,
  inline = false,
}: {
  title: string;
  /** Leave out on a tab's root screen: no back link is drawn. */
  onBack?: () => void;
  /** Where back goes, e.g. "Today". Shown beside the chevron. */
  backLabel?: string;
  /** A short line above the title, only when it adds something the title doesn't. */
  eyebrow?: string;
  subtitle?: string;
  /** Icon buttons (variant "outline") or a small AppButton, on the right. */
  actions?: React.ReactNode;
  inline?: boolean;
}) {
  const palette = useThemeColors();
  const scale = useFontScale();
  const space = useScaledSpace();

  const back = onBack ? (
    <Pressable
      onPress={onBack}
      accessibilityRole="button"
      accessibilityLabel={inline ? `Back to ${backLabel}` : undefined}
      hitSlop={8}
      className="flex-row items-center active:opacity-60 shrink"
      style={{ minHeight: MIN_TOUCH, marginLeft: -space(8), gap: space(1) }}
    >
      <ChevronLeft size={Math.round(28 * scale)} color={palette.accent} strokeWidth={2.4} />
      {inline ? null : (
        <AppText variant="body" className="font-sans text-accent shrink" numberOfLines={1}>
          {backLabel}
        </AppText>
      )}
    </Pressable>
  ) : null;

  const actionBox = actions ? (
    <View className="flex-row items-center shrink-0" style={{ gap: space(8) }}>
      {actions}
    </View>
  ) : null;

  if (inline) {
    return (
      <View className="flex-row items-center" style={{ minHeight: MIN_TOUCH, gap: space(6) }}>
        {back}
        <View className="flex-1">
          {eyebrow ? (
            <AppText variant="caption" className="font-sans font-medium text-ink-3" numberOfLines={1}>
              {eyebrow}
            </AppText>
          ) : null}
          <AppText variant="title" className="font-sans font-bold text-ink" numberOfLines={2}>
            {title}
          </AppText>
        </View>
        {actionBox}
      </View>
    );
  }

  return (
    <View style={{ gap: space(4) }}>
      {back || actionBox ? (
        <View className="flex-row items-center justify-between" style={{ minHeight: MIN_TOUCH, gap: space(12) }}>
          {back ?? <View />}
          {actionBox}
        </View>
      ) : null}
      {eyebrow ? (
        <AppText variant="section" className="font-sans font-semibold text-ink-3">
          {eyebrow}
        </AppText>
      ) : null}
      <AppText variant="display" className="font-sans font-bold text-ink" style={{ letterSpacing: -0.4 }}>
        {title}
      </AppText>
      {subtitle ? (
        <AppText variant="label" className="font-sans text-ink-2">
          {subtitle}
        </AppText>
      ) : null}
    </View>
  );
}

// ============================================================
// SectionHeader — the small grey label above a group. Sentence case: this
// replaces the uppercase tracked eyebrows, and is the only place a group
// label is drawn.
// ============================================================
export function SectionHeader({
  title,
  actionLabel,
  onAction,
}: {
  title: string;
  /** A small accent link on the right, e.g. "See all". */
  actionLabel?: string;
  onAction?: () => void;
}) {
  const space = useScaledSpace();
  return (
    <View className="flex-row items-end justify-between" style={{ paddingHorizontal: space(4), gap: space(8) }}>
      <AppText variant="section" className="font-sans font-semibold text-ink-3 flex-1" accessibilityRole="header">
        {title}
      </AppText>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} hitSlop={10} accessibilityRole="button" className="active:opacity-60 shrink-0">
          <AppText variant="section" className="font-sans font-semibold text-accent">
            {actionLabel}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

// ============================================================
// GroupedList + ListRow
//
// A card of rows, the way the iPhone's Settings app groups them. Dividers are
// inset to where the text starts, and the first row has none. GroupedList
// tells each row whether it is first through context, so a row never needs a
// prop for it and conditional rows ({x && <ListRow/>}) still divide right.
// ============================================================
const RowPosition = createContext<{ first: boolean }>({ first: true });

export function GroupedList({
  header,
  footer,
  children,
}: {
  /** Drawn as a SectionHeader above the card. */
  header?: string;
  /** A caption under the card: what the settings above it do. */
  footer?: string;
  children: React.ReactNode;
}) {
  const space = useScaledSpace();
  const rows = React.Children.toArray(children).filter(React.isValidElement);
  return (
    <View style={{ gap: space(6) }}>
      {header ? <SectionHeader title={header} /> : null}
      <View className="bg-surface border border-line rounded-card overflow-hidden">
        {rows.map((row, i) => (
          <RowPosition.Provider key={row.key ?? i} value={{ first: i === 0 }}>
            {row}
          </RowPosition.Provider>
        ))}
      </View>
      {footer ? (
        <AppText variant="caption" className="font-sans text-ink-3" style={{ paddingHorizontal: space(4) }}>
          {footer}
        </AppText>
      ) : null}
    </View>
  );
}

export function ListRow({
  title,
  subtitle,
  value,
  Icon,
  iconColor,
  onPress,
  accessory,
  destructive = false,
}: {
  title: string;
  subtitle?: string;
  /** The current setting, in grey on the right ("7:00 AM", "5 due"). */
  value?: string;
  /** A plain lucide icon in the accent. No tinted tile, per the chosen look. */
  Icon?: IconType;
  iconColor?: string;
  onPress?: () => void;
  /** Defaults to a chevron when the row is tappable. Pass a Switch, a Badge, or 'none'. */
  accessory?: 'chevron' | 'none' | React.ReactNode;
  /** Red title, for Delete / Leave rows. */
  destructive?: boolean;
}) {
  const palette = useThemeColors();
  const scale = useFontScale();
  const space = useScaledSpace();
  const { first } = useContext(RowPosition);
  // Past 1.3x a title and a value no longer share a line: the value moves
  // under the title, same rule as SettingRow.
  const stacked = scale >= 1.3;
  const shownAccessory = accessory ?? (onPress ? 'chevron' : 'none');

  const content = (
    <>
      {Icon ? (
        <View className="shrink-0">
          <Icon size={Math.round(22 * scale)} color={iconColor ?? (destructive ? palette.danger : palette.accent)} strokeWidth={2} />
        </View>
      ) : null}
      <View
        className={`flex-1 flex-row items-center ${first ? '' : 'border-t border-hairline'}`}
        style={{ minHeight: Math.round(52 * scale), paddingVertical: space(10), paddingRight: space(14), gap: space(8) }}
      >
        <View className="flex-1" style={{ gap: space(1) }}>
          <AppText variant="body" className={`font-sans ${destructive ? 'text-danger' : 'text-ink'}`}>
            {title}
          </AppText>
          {subtitle ? (
            <AppText variant="caption" className="font-sans text-ink-3">
              {subtitle}
            </AppText>
          ) : null}
          {value && stacked ? (
            <AppText variant="label" className="font-sans text-ink-3">
              {value}
            </AppText>
          ) : null}
        </View>
        {value && !stacked ? (
          <AppText variant="body" className="font-sans text-ink-3 shrink-0 text-right" style={{ maxWidth: '50%' }}>
            {value}
          </AppText>
        ) : null}
        {shownAccessory === 'chevron' ? (
          <View className="shrink-0">
            <ChevronRight size={Math.round(18 * scale)} color={palette.ink3} strokeWidth={2.4} />
          </View>
        ) : shownAccessory === 'none' ? null : (
          <View className="shrink-0">{shownAccessory}</View>
        )}
      </View>
    </>
  );

  const rowClass = 'flex-row items-center';
  const rowStyle = { paddingLeft: space(14), gap: space(12) };
  if (!onPress) {
    return (
      <View className={rowClass} style={rowStyle}>
        {content}
      </View>
    );
  }
  return (
    <Pressable onPress={onPress} accessibilityRole="button" className={`${rowClass} active:bg-surface-2`} style={rowStyle}>
      {content}
    </Pressable>
  );
}

// ============================================================
// SegmentedControl — two to five short labels, exactly one chosen.
//
// A fill-colored tray with the chosen segment raised in it. The raised look
// is a card color and a thin edge rather than a shadow: a shadow that moved
// with the selection would be a conditional shadow, which freezes iOS.
// Labels wrap at large text rather than being cut off.
// ============================================================
export interface SegmentOption<T extends string | number> {
  id: T;
  label: string;
}

export function SegmentedControl<T extends string | number>({
  options,
  value,
  onChange,
  accessibilityLabel,
}: {
  options: SegmentOption<T>[];
  value: T;
  onChange: (id: T) => void;
  accessibilityLabel?: string;
}) {
  const scale = useFontScale();
  const space = useScaledSpace();
  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel={accessibilityLabel}
      className="flex-row bg-fill rounded-seg"
      style={{ padding: 2, gap: 2 }}
    >
      {options.map((opt) => {
        const active = opt.id === value;
        return (
          <Pressable
            key={String(opt.id)}
            onPress={() => onChange(opt.id)}
            accessibilityRole="radio"
            accessibilityState={{ checked: active }}
            aria-checked={active}
            className={`items-center justify-center rounded-seg-inner border ${
              active ? 'bg-raised border-line' : 'border-transparent active:bg-raised/50'
            }`}
            // Sized by label, then the spare width shared out evenly: "Last 30
            // Days" gets more room than "All", instead of every segment
            // getting the same slice and the long one wrapping (the iPhone's
            // apportionsSegmentWidthsByContent).
            style={{
              flexGrow: 1,
              flexShrink: 1,
              flexBasis: 'auto',
              minHeight: Math.round(32 * scale),
              paddingVertical: space(5),
              paddingHorizontal: space(6),
            }}
          >
            {/* No line limit: at large text a label wraps rather than being cut. */}
            <AppText
              variant="caption"
              className={`font-sans text-center ${active ? 'font-semibold text-ink' : 'font-medium text-ink-2'}`}
            >
              {opt.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

// ============================================================
// Badge — a small status pill. Sentence case, a soft tint of its tone.
// Stage colors are not tones: they fail as text, so a stage is shown as a
// colored dot beside an ink label instead.
// ============================================================
export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warning' | 'danger';

const BADGE_TONE: Record<BadgeTone, { box: string; text: string }> = {
  neutral: { box: 'bg-surface-2 border border-line', text: 'text-ink-2' },
  accent: { box: 'bg-accent-soft', text: 'text-accent' },
  success: { box: 'bg-success-soft', text: 'text-success' },
  warning: { box: 'bg-warning-soft', text: 'text-warning' },
  danger: { box: 'bg-danger-soft', text: 'text-danger' },
};

export function Badge({ label, tone = 'neutral', Icon }: { label: string; tone?: BadgeTone; Icon?: IconType }) {
  const palette = useThemeColors();
  const scale = useFontScale();
  const space = useScaledSpace();
  const t = BADGE_TONE[tone];
  const iconColor =
    tone === 'neutral' ? palette.ink2 : tone === 'accent' ? palette.accent : palette[tone];
  return (
    <View
      className={`flex-row items-center self-start rounded-full ${t.box}`}
      style={{ paddingHorizontal: space(8), paddingVertical: space(2), gap: space(4) }}
    >
      {Icon ? <Icon size={Math.round(12 * scale)} color={iconColor} strokeWidth={2.4} /> : null}
      <AppText variant="micro" className={`font-sans font-semibold ${t.text}`} numberOfLines={1}>
        {label}
      </AppText>
    </View>
  );
}

// ============================================================
// Avatar — a photo, or the first letter on the accent tint. No thick ring.
// `ring` draws a card-colored edge so overlapping avatars in a stack stay
// separate, instead of the next one's edge cutting the initial.
// The circle holds no scalable text (the initial is sized to the circle), so
// a fixed size is correct.
// ============================================================
export function Avatar({
  name,
  photoUri,
  size = 40,
  ring = false,
}: {
  name?: string | null;
  photoUri?: string | null;
  size?: number;
  ring?: boolean;
}) {
  const shape = { width: size, height: size, borderRadius: size / 2 };
  const ringClass = ring ? 'border-2 border-surface' : '';
  if (photoUri) {
    return <Image source={{ uri: photoUri }} style={shape} className={ring ? ringClass : 'border border-line'} />;
  }
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
  return (
    <View style={shape} className={`bg-accent-soft items-center justify-center ${ringClass}`}>
      <AppText variant="inherit" className="font-sans font-semibold text-accent" style={{ fontSize: size * 0.42 }}>
        {initial}
      </AppText>
    </View>
  );
}

// ============================================================
// EmptyState — what an empty list says. One short title, at most one
// sentence under it, and the action that fills it. No dashed box.
// ============================================================
export function EmptyState({
  Icon,
  title,
  message,
  actionLabel,
  onAction,
}: {
  Icon?: IconType;
  title: string;
  message?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  const palette = useThemeColors();
  const scale = useFontScale();
  const space = useScaledSpace();
  return (
    <View className="items-center" style={{ paddingVertical: space(24), paddingHorizontal: space(16), gap: space(8) }}>
      {Icon ? (
        <View
          className="rounded-full bg-accent-soft items-center justify-center"
          style={{ width: Math.round(52 * scale), height: Math.round(52 * scale), marginBottom: space(4) }}
        >
          <Icon size={Math.round(24 * scale)} color={palette.accent} strokeWidth={2} />
        </View>
      ) : null}
      <AppText variant="body" className="font-sans font-semibold text-ink text-center">
        {title}
      </AppText>
      {message ? (
        <AppText variant="label" className="font-sans text-ink-2 text-center" style={{ maxWidth: 320 }}>
          {message}
        </AppText>
      ) : null}
      {actionLabel && onAction ? (
        <AppButton variant="secondary" label={actionLabel} onPress={onAction} style={{ marginTop: space(8) }} />
      ) : null}
    </View>
  );
}

// ============================================================
// Dialog — the one overlay pattern.
//
// Today there are ten `absolute inset-0` overlays and eleven RN Modals, each
// with its own backdrop, radius and button row. This replaces both:
//
//   placement 'center'  a dialog: confirm, save, a short choice
//   placement 'sheet'   slides up from the bottom: pickers, lists, forms
//
// Always a real Modal, so it sits above the tab bar and anything else, and the
// body scrolls inside a height cap while `actions` stay pinned below it. (The
// missed-review prompt's Apply button fell off an 844pt screen because its
// card had a maxHeight but no scroll; that can't happen here.)
//
// Numeric inputs inside a Dialog need their own NumericKeyboardAccessory with
// a distinct nativeID (see ui.tsx): a Modal is its own view controller on iOS.
// ============================================================
export function Dialog({
  visible,
  onClose,
  title,
  message,
  children,
  actions,
  placement = 'center',
  dismissable = true,
}: {
  visible: boolean;
  onClose: () => void;
  title?: string;
  message?: string;
  children?: React.ReactNode;
  /** Buttons along the bottom, pinned below the scrolling body. Primary last. */
  actions?: React.ReactNode;
  placement?: 'center' | 'sheet';
  /** When false, tapping outside and the close button do nothing (a choice is required). */
  dismissable?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const { height: winHeight } = useWindowDimensions();
  const space = useScaledSpace();
  const sheet = placement === 'sheet';
  const dismiss = dismissable ? onClose : () => {};

  return (
    <Modal
      visible={visible}
      transparent
      animationType={sheet ? 'slide' : 'fade'}
      onRequestClose={dismiss}
      statusBarTranslucent
    >
      {/* Pinned to all four edges with pointerEvents set directly: RN-Web's
          Modal wraps children in a pointerEvents:'none' container, and a
          plain flex-1 child doesn't reliably fill it, so the dismiss tap
          would fall through to the page behind. Same fix as Dropdown. */}
      <Pressable
        onPress={dismiss}
        pointerEvents="auto"
        accessible={false}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        className={`bg-black/40 ${sheet ? 'justify-end' : 'items-center justify-center px-5'}`}
      >
        {/* Swallows taps inside the dialog so they don't reach the backdrop. */}
        <Pressable
          onPress={() => {}}
          accessible={false}
          accessibilityViewIsModal
          className={`bg-surface ${sheet ? 'rounded-t-card' : 'rounded-card border border-line'}`}
          style={{
            width: '100%',
            maxWidth: sheet ? undefined : 420,
            maxHeight: winHeight * (sheet ? 0.9 : 0.85) - (sheet ? 0 : insets.top + insets.bottom),
          }}
        >
          {title || dismissable ? (
            <View
              className="flex-row items-start"
              style={{ paddingHorizontal: space(18), paddingTop: space(16), gap: space(12) }}
            >
              <View className="flex-1" style={{ gap: space(4), paddingTop: space(2) }}>
                {title ? (
                  <AppText variant="title" className="font-sans font-bold text-ink" accessibilityRole="header">
                    {title}
                  </AppText>
                ) : null}
              </View>
              {dismissable ? (
                <AppIconButton Icon={X} variant="outline" diameter={30} onPress={onClose} accessibilityLabel="Close" />
              ) : null}
            </View>
          ) : null}

          <ScrollView
            style={{ flexShrink: 1, flexGrow: 0 }}
            contentContainerStyle={{
              paddingHorizontal: space(18),
              paddingTop: space(title || dismissable ? 8 : 18),
              paddingBottom: actions ? space(4) : space(18) + (sheet ? insets.bottom : 0),
              gap: space(12),
            }}
            keyboardShouldPersistTaps="handled"
          >
            {message ? (
              <AppText variant="body" className="font-sans text-ink-2">
                {message}
              </AppText>
            ) : null}
            {children}
          </ScrollView>

          {actions ? (
            <View
              className="flex-row flex-wrap justify-end"
              style={{
                paddingHorizontal: space(18),
                paddingTop: space(12),
                paddingBottom: space(18) + (sheet ? insets.bottom : 0),
                gap: space(8),
              }}
            >
              {actions}
            </View>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
