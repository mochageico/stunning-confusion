import React, { useState } from 'react';
import { Platform, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Check, ChevronDown, ChevronRight, MoreHorizontal, SlidersHorizontal, X } from 'lucide-react-native';

import { AppButton, AppIconButton, AppText, MIN_TOUCH, useFontScale, useScaledSpace } from './design';
import { Dialog, GroupedList, ListRow } from './blocks';
import { useKeyboardHeight } from './ui';
import { useThemeColors } from './theme';

// ============================================================================
// SESSION AND SIMPLIFY PIECES (UI simplify plan, Job 0)
//
// The shared parts the page-by-page simplify jobs build from. The plan, and
// the owner's decisions behind each piece, live in .claude/ui-simplify-plan.md;
// the sketches are linked from there.
//
//   SessionShell   full-screen frame for practice, listen and review sessions:
//                  close, progress, gear; a body; one bottom action bar
//   SessionDone    the shared "you finished" page a session ends on
//   OptionsPopup   a session's settings, behind the gear, as a CENTERED pop-up
//   OverflowMenu   the "..." button and its menu; destructive items confirm
//   ActionCard     a big two-line tappable card (Today's Review / Learn next)
//   IconTile       the small soft square an icon sits in at the start of a row
//   ModeChip       the "Recall v" pill: the current choice, tap to change it
//
// Owner rules these follow (2026-11-10):
//   - Pop-ups open in the middle of the screen, never slide up from the
//     bottom ("glitchy and annoying"). OptionsPopup and OverflowMenu use
//     Dialog's centered placement only.
//   - One button, one job: audio actions never share the look of the
//     practice buttons. ActionCard is for practice; audio rows use IconTile
//     with the headphones icon instead.
//   - Actions used every time (Start over, Show next word) stay in the
//     bottom bar, not behind the gear.
// ============================================================================

type IconType = React.ComponentType<{ size?: number; color?: string; strokeWidth?: number }>;

// ============================================================
// SessionShell
//
// Covers the whole screen, tab bar included (it is meant to be rendered as
// an overlay, the way PracticeModals already is). Top: close, a progress
// bar with "2 of 5", and an optional gear. Bottom: `bottomBar`, which rides
// up with the keyboard on iOS.
// ============================================================
export function SessionShell({
  onClose,
  progress,
  progressLabel,
  onOptions,
  headerRight,
  bottomBar,
  scroll = true,
  children,
}: {
  onClose: () => void;
  /** 0 to 1. Leave out for a session with no fixed length (Listen). */
  progress?: number;
  /** Short text beside the bar, e.g. "2 of 5". */
  progressLabel?: string;
  /** Opens this session's OptionsPopup. Leave out and no gear is drawn. */
  onOptions?: () => void;
  /** Anything else for the header's right side, before the gear. */
  headerRight?: React.ReactNode;
  bottomBar?: React.ReactNode;
  /** False when the body manages its own scrolling (a FlatList, a canvas). */
  scroll?: boolean;
  children: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const space = useScaledSpace();
  const keyboard = useKeyboardHeight();
  const lift = Platform.OS === 'ios' ? keyboard : 0;

  const body = scroll ? (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{ paddingHorizontal: space(20), paddingTop: space(16), paddingBottom: space(24), gap: space(14) }}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </ScrollView>
  ) : (
    <View className="flex-1">{children}</View>
  );

  return (
    <View className="absolute inset-0 z-50 bg-canvas" style={{ paddingTop: insets.top }}>
      <View className="flex-row items-center" style={{ minHeight: MIN_TOUCH + space(8), paddingHorizontal: space(16), gap: space(12) }}>
        <AppIconButton Icon={X} variant="outline" diameter={40} onPress={onClose} accessibilityLabel="Close" />
        <View className="flex-1">{progress !== undefined ? <SessionProgress value={progress} /> : null}</View>
        {progressLabel ? (
          <AppText variant="caption" className="font-sans font-semibold text-ink-3">
            {progressLabel}
          </AppText>
        ) : null}
        {headerRight}
        {onOptions ? (
          <AppIconButton Icon={SlidersHorizontal} variant="outline" diameter={40} onPress={onOptions} accessibilityLabel="Options" />
        ) : null}
      </View>

      {body}

      {bottomBar ? (
        <View
          className="bg-surface border-t border-line"
          style={{
            paddingHorizontal: space(16),
            paddingTop: space(14),
            paddingBottom: (lift > 0 ? space(10) : Math.max(insets.bottom, space(14)) + space(10)),
            marginBottom: lift,
            gap: space(10),
          }}
        >
          {bottomBar}
        </View>
      ) : null}
    </View>
  );
}

function SessionProgress({ value }: { value: number }) {
  const clamped = Math.max(0, Math.min(1, value));
  return (
    <View
      className="bg-fill rounded-full overflow-hidden"
      style={{ height: 8 /* layout-ok: a progress track, it holds no text */ }}
      accessibilityRole="progressbar"
      accessibilityValue={{ min: 0, max: 100, now: Math.round(clamped * 100) }}
    >
      <View className="bg-accent rounded-full" style={{ height: 8 /* layout-ok: the track's fill */, width: `${clamped * 100}%` }} />
    </View>
  );
}

// ============================================================
// SessionDone — the one finish page every session ends on.
// ============================================================
export function SessionDone({
  title,
  subtitle,
  stats,
  children,
  doneLabel = 'Done',
  onDone,
  secondary,
}: {
  title: string;
  subtitle?: string;
  /** Two to four short numbers, e.g. { value: 5, label: 'reviewed' }. */
  stats?: { value: string | number; label: string }[];
  /** Anything specific to this session, under the numbers (per-passage outcomes, an offer). */
  children?: React.ReactNode;
  doneLabel?: string;
  onDone: () => void;
  /** One quiet second action, e.g. "Keep going". */
  secondary?: { label: string; onPress: () => void };
}) {
  const palette = useThemeColors();
  const scale = useFontScale();
  const space = useScaledSpace();
  const insets = useSafeAreaInsets();
  const badge = Math.round(72 * scale);

  return (
    <View className="absolute inset-0 z-50 bg-canvas" style={{ paddingTop: insets.top }}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ paddingHorizontal: space(20), paddingTop: space(48), paddingBottom: space(24), gap: space(18), alignItems: 'stretch' }}
      >
        <View className="items-center" style={{ gap: space(12) }}>
          {/* layout-ok: an icon circle. */}
          <View className="bg-success-soft rounded-full items-center justify-center" style={{ width: badge, height: badge }}>
            <Check size={Math.round(36 * scale)} color={palette.success} strokeWidth={2.6} />
          </View>
          <AppText variant="display" className="font-sans font-bold text-ink text-center" accessibilityRole="header">
            {title}
          </AppText>
          {subtitle ? (
            <AppText variant="body" className="font-sans text-ink-2 text-center">
              {subtitle}
            </AppText>
          ) : null}
        </View>

        {stats && stats.length ? (
          <View className="bg-surface border border-line rounded-card flex-row" style={{ paddingVertical: space(14) }}>
            {stats.map((s, i) => (
              <View key={s.label} className={`flex-1 items-center ${i ? 'border-l border-hairline' : ''}`} style={{ paddingHorizontal: space(6) }}>
                <AppText variant="display" className="font-sans font-bold text-ink">
                  {String(s.value)}
                </AppText>
                <AppText variant="caption" className="font-sans text-ink-3 text-center">
                  {s.label}
                </AppText>
              </View>
            ))}
          </View>
        ) : null}

        {children}
      </ScrollView>

      <View
        className="bg-surface border-t border-line"
        style={{ paddingHorizontal: space(16), paddingTop: space(14), paddingBottom: Math.max(insets.bottom, space(14)) + space(10), gap: space(8) }}
      >
        <AppButton variant="primary" size="lg" label={doneLabel} onPress={onDone} />
        {secondary ? <AppButton variant="quiet" label={secondary.label} onPress={secondary.onPress} /> : null}
      </View>
    </View>
  );
}

// ============================================================
// OptionsPopup — a session's settings behind the gear. Centered, with Done.
// ============================================================
export function OptionsPopup({
  visible,
  onClose,
  title,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  /** Name what the settings belong to: "Recall settings", "Listen settings". */
  title: string;
  children: React.ReactNode;
}) {
  return (
    <Dialog
      visible={visible}
      onClose={onClose}
      title={title}
      placement="center"
      actions={<AppButton variant="primary" label="Done" onPress={onClose} style={{ flex: 1 }} />}
    >
      {children}
    </Dialog>
  );
}

// ============================================================
// OverflowMenu — the "..." button and the centered menu it opens.
//
// Rare and destructive actions live here instead of on the page. A
// destructive item with `confirm` asks before it runs; one without runs at
// once (use that only when the action is undoable).
// ============================================================
export interface MenuItem {
  label: string;
  Icon?: IconType;
  /** Grey text on the right ("5 min a day"). */
  value?: string;
  onPress: () => void;
  destructive?: boolean;
  confirm?: { title: string; message?: string; confirmLabel: string };
}

export function OverflowMenu({
  title,
  groups,
  accessibilityLabel = 'More',
  diameter = 40,
}: {
  title?: string;
  /** Each inner list is drawn as its own card, so destructive items can sit apart. */
  groups: MenuItem[][];
  accessibilityLabel?: string;
  diameter?: number;
}) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<MenuItem | null>(null);

  const choose = (item: MenuItem) => {
    setOpen(false);
    if (item.confirm) setConfirming(item);
    else item.onPress();
  };

  return (
    <>
      <AppIconButton Icon={MoreHorizontal} variant="outline" diameter={diameter} onPress={() => setOpen(true)} accessibilityLabel={accessibilityLabel} />
      <Dialog visible={open} onClose={() => setOpen(false)} title={title} placement="center">
        {groups
          .filter((g) => g.length)
          .map((group, gi) => (
            <GroupedList key={gi}>
              {group.map((item) => (
                <ListRow
                  key={item.label}
                  title={item.label}
                  Icon={item.Icon}
                  value={item.value}
                  destructive={item.destructive}
                  onPress={() => choose(item)}
                  accessory="none"
                />
              ))}
            </GroupedList>
          ))}
      </Dialog>
      <Dialog
        visible={!!confirming}
        onClose={() => setConfirming(null)}
        title={confirming?.confirm?.title}
        message={confirming?.confirm?.message}
        placement="center"
        actions={
          <>
            <AppButton variant="quiet" label="Cancel" onPress={() => setConfirming(null)} />
            <AppButton
              variant={confirming?.destructive ? 'destructive' : 'primary'}
              label={confirming?.confirm?.confirmLabel ?? 'OK'}
              onPress={() => {
                const item = confirming;
                setConfirming(null);
                item?.onPress();
              }}
            />
          </>
        }
      />
    </>
  );
}

// ============================================================
// ActionCard — Today's two big buttons. An icon tile, a bold title, one line
// under it, and a chevron. `primary` is the accent fill; `soft` the
// accent-soft fill. At most two on a screen (owner's rule for Today).
// ============================================================
export function ActionCard({
  title,
  subtitle,
  Icon,
  onPress,
  tone = 'primary',
  disabled,
}: {
  title: string;
  subtitle?: string;
  Icon: IconType;
  onPress: () => void;
  tone?: 'primary' | 'soft';
  disabled?: boolean;
}) {
  const palette = useThemeColors();
  const scale = useFontScale();
  const space = useScaledSpace();
  const primary = tone === 'primary';
  const fg = primary ? palette.onAccent : palette.accent;
  const tile = Math.round(42 * scale);

  return (
    // button-ok: a two-line card button with an icon tile; AppButton is one line of label.
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={subtitle ? `${title}, ${subtitle}` : title}
      accessibilityState={disabled ? { disabled: true } : undefined}
      className={`flex-row items-center rounded-card active:opacity-80 ${primary ? 'bg-accent' : 'bg-accent-soft'}`}
      style={[{ paddingVertical: space(14), paddingHorizontal: space(16), gap: space(14), minHeight: Math.round(72 * scale) }, disabled ? { opacity: 0.45 } : null]}
    >
      {/* layout-ok: an icon tile. */}
      <View className={`items-center justify-center rounded-btn overflow-hidden ${primary ? '' : 'bg-surface'}`} style={{ width: tile, height: tile }}>
        {/* On the accent the tile is the text color at 16%. Drawn as its own
            layer so the opacity doesn't fade the icon; the icon sits in a
            View so it stacks above that layer on web. */}
        {primary ? (
          <View
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: palette.onAccent, opacity: 0.16 }}
          />
        ) : null}
        <View>
          <Icon size={Math.round(22 * scale)} color={fg} strokeWidth={2} />
        </View>
      </View>
      <View className="flex-1" style={{ gap: space(1) }}>
        <AppText variant="title" className={`font-sans font-bold ${primary ? 'text-on-accent' : 'text-accent'}`}>
          {title}
        </AppText>
        {subtitle ? (
          <AppText variant="label" className={`font-sans ${primary ? 'text-on-accent' : 'text-ink-2'}`} style={primary ? { opacity: 0.85 } : undefined}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      <ChevronRight size={Math.round(20 * scale)} color={fg} strokeWidth={2.2} />
    </Pressable>
  );
}

// ============================================================
// IconTile — a soft square holding a row's icon. Pass it as ListRow's
// `leading`. Used for Today's "Today's verses" and "Listen to today's
// scripture" rows, so audio reads differently from the ActionCards.
// ============================================================
export function IconTile({ Icon, size = 36 }: { Icon: IconType; size?: number }) {
  const palette = useThemeColors();
  const scale = useFontScale();
  const d = Math.round(size * scale);
  return (
    // layout-ok: an icon tile, no text.
    <View className="bg-canvas items-center justify-center" style={{ width: d, height: d, borderRadius: Math.round(d * 0.28) }}>
      <Icon size={Math.round(size * 0.53 * scale)} color={palette.accent} strokeWidth={2} />
    </View>
  );
}

// ============================================================
// ModeChip — shows the current choice ("Recall") with a down chevron; tap to
// change it. The practice header's way-to-practice picker. The gear next to
// it holds that mode's settings, never the list of modes.
// ============================================================
export function ModeChip({ label, onPress, accessibilityLabel }: { label: string; onPress: () => void; accessibilityLabel?: string }) {
  const palette = useThemeColors();
  const scale = useFontScale();
  const space = useScaledSpace();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? `${label}, change`}
      hitSlop={6}
      className="flex-row items-center bg-surface border border-line-strong rounded-full active:bg-surface-2"
      style={{ paddingVertical: space(6), paddingLeft: space(14), paddingRight: space(10), gap: space(4), minHeight: Math.round(34 * scale) }}
    >
      <AppText variant="label" className="font-sans font-semibold text-accent">
        {label}
      </AppText>
      <ChevronDown size={Math.round(16 * scale)} color={palette.accent} strokeWidth={2.2} />
    </Pressable>
  );
}
