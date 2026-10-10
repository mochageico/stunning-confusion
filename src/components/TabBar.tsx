import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import type { LucideIcon } from 'lucide-react-native';

import { AppText } from './design';
import { useThemeColors } from './theme';

/**
 * The floating tab bar (job F4): a pill that hovers over the page with a
 * margin on every side, instead of a full-width strip glued to the bottom.
 *
 * It is laid out below the screens rather than over them, so a screen's
 * content ends just above it and can never be hidden underneath. No screen
 * needs a bottom inset of its own; PageFade softens the edge where the
 * content stops.
 */

/** The pill's height. Labels are capped at 1.15x, so it never needs to grow. */
export const TAB_BAR_HEIGHT = 58;
/** Space between stacked floating bars (now playing, tab bar). */
export const BAR_GAP = 8;
const SIDE_MARGIN = 16;
const FADE_HEIGHT = 14;

/**
 * Distance from the screen's bottom edge to the bottom of the pill: just
 * clear of the home indicator on Face ID phones (whose inset is mostly empty
 * space below the content), BAR_GAP on phones with a home button.
 */
export function tabBarBottom(insetBottom: number): number {
  return insetBottom > 0 ? Math.max(insetBottom - 12, BAR_GAP) : BAR_GAP;
}

/** Where something floating just above the tab bar should put its bottom edge. */
export function useAboveTabBar(): number {
  const insets = useSafeAreaInsets();
  return tabBarBottom(insets.bottom) + TAB_BAR_HEIGHT + BAR_GAP;
}

/**
 * The bottom tray: whatever floats above the tab bar (the now-playing pill),
 * then the tab bar itself, on the page color, with the same side margins.
 */
export function BottomBars({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <View
      className="bg-canvas"
      style={{
        paddingTop: BAR_GAP,
        paddingBottom: tabBarBottom(insets.bottom),
        paddingLeft: SIDE_MARGIN + insets.left,
        paddingRight: SIDE_MARGIN + insets.right,
        gap: BAR_GAP,
      }}
    >
      {children}
    </View>
  );
}

export type TabItem<T extends string> = { id: T; label: string; Icon: LucideIcon };

export function FloatingTabBar<T extends string>({
  tabs,
  current,
  onSelect,
}: {
  tabs: TabItem<T>[];
  current: T;
  onSelect: (id: T) => void;
}) {
  const palette = useThemeColors();
  return (
    // One static shadow, always on: the bar mounts and unmounts whole (chat
    // screens, keyboard), it never toggles a shadow class (see
    // ios-fabric-shadow-deadlock).
    <View
      accessibilityRole="tablist"
      className="flex-row bg-surface border border-line rounded-full shadow-md"
      // layout-ok: the labels inside are capped at 1.15x, so the bar never needs to grow
      style={{ height: TAB_BAR_HEIGHT, padding: 5, gap: 2 }}
    >
      {tabs.map((tab) => {
        const active = tab.id === current;
        const Icon = tab.Icon;
        return (
          <Pressable
            key={tab.id}
            onPress={() => onSelect(tab.id)}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={tab.label}
            // grow, not flex-1: each tab starts from its own label's width and
            // shares out what's left, so with five tabs "Community" gets the
            // room it needs at large text on an SE (equal fifths cut it off).
            className={`grow items-center justify-center rounded-full ${active ? 'bg-accent-soft' : 'active:bg-fill'}`}
            style={{ gap: 2, paddingHorizontal: 4 }}
          >
            <Icon size={20} color={active ? palette.accent : palette.ink3} strokeWidth={active ? 2.4 : 2} />
            {/* Capped, like iOS's own tab bar: five labels share a fixed row,
                and at 1.5x "Community" ran into its neighbours on an SE. */}
            <AppText
              variant="micro"
              maxScale={1.15}
              numberOfLines={1}
              className={`font-sans tracking-tight ${active ? 'font-bold text-accent' : 'font-semibold text-ink-3'}`}
            >
              {tab.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

/**
 * A short fade to the page color along the bottom edge of the screen area, so
 * content scrolling past the bottom dissolves into the gap above the tab bar
 * instead of being cut off by a hard line.
 */
export function PageFade() {
  const palette = useThemeColors();
  return (
    <View
      pointerEvents="none"
      // layout-ok: a decorative gradient, no text
      style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: FADE_HEIGHT }}
    >
      <Svg width="100%" height="100%" preserveAspectRatio="none">
        <Defs>
          <LinearGradient id="pageFade" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={palette.canvas} stopOpacity={0} />
            <Stop offset="1" stopColor={palette.canvas} stopOpacity={1} />
          </LinearGradient>
        </Defs>
        <Rect x="0" y="0" width="100%" height="100%" fill="url(#pageFade)" />
      </Svg>
    </View>
  );
}
