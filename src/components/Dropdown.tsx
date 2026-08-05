import React, { useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, View, useWindowDimensions } from 'react-native';
import { Check, ChevronDown, Search } from 'lucide-react-native';

import { AppTextInput, AppText, MIN_TOUCH, useFontScale, useScaledSpace } from './design';

/**
 * Generic single-select dropdown: a trigger button showing the current value,
 * opening a menu ANCHORED TO THE TRIGGER. Use this (instead of a ChipRow
 * of buttons side by side) for any choice list that's long, will grow over
 * time (e.g. translations, once more are added), or pairs with another field
 * in a way that a horizontal row of chips can't comfortably fit next to
 * (chapter numbers alongside a book picker, etc).
 *
 * NOT a bottom sheet. This used to slide a 75%-height panel up from the
 * bottom of the screen for a five-item list -- a full-screen gesture, and a
 * long way for the eye to travel, to pick "NIV". The menu now opens directly
 * under (or over, near the bottom of the screen) the button you tapped, the
 * way a dropdown is expected to behave. BookPicker keeps the sheet on
 * purpose: 66 books grouped by testament is a browse, not a pick.
 */
export interface DropdownOption<T extends string | number> {
  id: T;
  label: string;
}

/** Gap between the trigger and the menu, and the menu and the screen edge. */
const EDGE = 8;
/** Menus never grow past this, however much room is below the trigger. */
const MENU_MAX_HEIGHT = 300;
/** A menu narrower than this is unreadable however narrow its trigger is. */
const MENU_MIN_WIDTH = 150;
/** Below this much room underneath the trigger, the menu opens upward instead. */
const FLIP_THRESHOLD = 170;

export function Dropdown<T extends string | number>({
  value,
  options,
  onChange,
  placeholder = 'Select...',
  title = 'Select an option',
  searchable,
  staticLabel,
  compact,
}: {
  value: T;
  options: DropdownOption<T>[];
  onChange: (id: T) => void;
  placeholder?: string;
  /** Accessibility label for the trigger. The menu itself has no title bar --
   * an anchored dropdown is identified by the control it hangs off. */
  title?: string;
  /** Adds a search box above the list. Defaults to on for longer lists. */
  searchable?: boolean;
  /** Trigger always shows `placeholder` (e.g. "View") instead of the current
   * selection -- for a compact action-menu feel where discovering the
   * current value is a secondary concern to keeping the trigger label
   * stable and short. Off by default (trigger shows the selected option, a
   * real value-picker) to match every other use of this component. */
  staticLabel?: boolean;
  /** Shrinks the TRIGGER's text one step (label -> micro) for a dropdown that
   * sits inline beside a micro-sized label, where the default size makes the
   * control shout over the thing naming it. The menu's own options are
   * deliberately NOT shrunk -- the menu has room, and a pick list is where
   * legibility matters most. Off by default. */
  compact?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  // Where the trigger sits in window coordinates, captured at open time. Null
  // until the first measure lands (or if measuring fails outright, which the
  // fallback below covers rather than rendering nothing).
  const [anchor, setAnchor] = useState<{ x: number; y: number; width: number; height: number } | null>(null);
  const triggerRef = useRef<View>(null);
  const { width: winWidth, height: winHeight } = useWindowDimensions();
  const scale = useFontScale();
  const space = useScaledSpace();
  const showSearch = searchable ?? options.length > 10;

  const filtered = useMemo(() => {
    if (!showSearch || !query.trim()) return options;
    const q = query.trim().toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query, showSearch]);

  const selected = options.find((o) => o.id === value);

  const openMenu = () => {
    const node = triggerRef.current;
    if (!node) {
      setOpen(true);
      return;
    }
    // Measure before opening, so the menu paints in the right place on its
    // very first frame instead of jumping there afterward.
    node.measureInWindow((x, y, width, height) => {
      setAnchor({ x, y, width, height });
      setOpen(true);
    });
  };

  const close = () => {
    setOpen(false);
    setQuery('');
  };

  const select = (id: T) => {
    onChange(id);
    close();
  };

  // Placement. A trigger low on the screen flips the menu upward rather than
  // squeezing it into 20pt of leftover room.
  // layout-ok: measured window coordinates, not a style — the fallback stands
  // in for a trigger we couldn't measure, and a zero-height one is exactly
  // what "we don't know where it is" should mean.
  const a = anchor ?? { x: EDGE, y: Math.round(winHeight / 3), width: winWidth - EDGE * 2, height: 0 };
  const roomBelow = winHeight - (a.y + a.height) - EDGE;
  const roomAbove = a.y - EDGE;
  const dropUp = roomBelow < FLIP_THRESHOLD && roomAbove > roomBelow;
  const maxHeight = Math.min(MENU_MAX_HEIGHT * scale, Math.max(120, dropUp ? roomAbove : roomBelow));
  const menuWidth = Math.min(Math.max(a.width, MENU_MIN_WIDTH * scale), winWidth - EDGE * 2);
  const left = Math.max(EDGE, Math.min(a.x, winWidth - menuWidth - EDGE));

  return (
    // collapsable={false} keeps this View in the native hierarchy on Android --
    // a bare wrapper View is otherwise flattened away, and a flattened view
    // has nothing to measure.
    <View ref={triggerRef} collapsable={false}>
      <Pressable
        onPress={openMenu}
        accessibilityRole="button"
        accessibilityLabel={title}
        accessibilityState={{ expanded: open }}
        className="flex-row items-center justify-between bg-white border border-neutral-300 rounded-xl"
        style={{ minHeight: MIN_TOUCH, paddingHorizontal: space(12), paddingVertical: space(8), gap: space(6) }}
      >
        <AppText
          variant={compact ? 'micro' : 'label'}
          className={`font-sans font-bold flex-1 ${selected || staticLabel ? 'text-[#1A1A1A]' : 'text-neutral-500'}`}
          numberOfLines={1}
        >
          {staticLabel ? placeholder : selected ? selected.label : placeholder}
        </AppText>
        <View className="shrink-0">
          <ChevronDown size={Math.round(14 * scale)} color="#525252" />
        </View>
      </Pressable>

      <Modal visible={open} animationType="none" transparent onRequestClose={close}>
        {/* Pinned to all four edges with pointerEvents set directly: RN-Web's
            Modal wraps children in a pointerEvents:'none' container, and a
            plain flex-1 child doesn't reliably fill it -- the dismiss tap
            then falls through to the page behind. Same fix as HelpTooltip. */}
        <Pressable
          onPress={close}
          pointerEvents="auto"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        >
          {/* Swallows taps inside the menu so they don't bubble to the
              backdrop and close it before a row can register. */}
          <Pressable
            onPress={() => {}}
            className="bg-white border border-neutral-300 rounded-xl shadow-lg overflow-hidden"
            style={{
              position: 'absolute',
              left,
              width: menuWidth,
              maxHeight,
              ...(dropUp ? { bottom: winHeight - a.y + 4 } : { top: a.y + a.height + 4 }),
            }}
          >
            {showSearch && (
              <View
                className="border-b border-neutral-100"
                style={{ paddingHorizontal: space(8), paddingVertical: space(8) }}
              >
                <View className="relative justify-center">
                  <View className="absolute left-2.5 z-10">
                    <Search size={Math.round(13 * scale)} color="#a3a3a3" />
                  </View>
                  {/* No autoFocus: the software keyboard would cover the very
                      rows this menu just opened to show. */}
                  <AppTextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Search..."
                    placeholderTextColor="#a3a3a3"
                    allowFontScaling={false}
                    className="w-full bg-neutral-50 border border-neutral-200 rounded-lg text-[#1A1A1A]"
                    style={{
                      fontSize: 13 * scale,
                      paddingVertical: space(6),
                      paddingLeft: space(28),
                      paddingRight: space(8),
                    }} />
                </View>
              </View>
            )}

            <ScrollView keyboardShouldPersistTaps="handled">
              {filtered.length === 0 ? (
                <AppText variant="caption" className="text-center text-neutral-500 font-sans" style={{ padding: space(16) }}>
                  No matches.
                </AppText>
              ) : (
                filtered.map((opt, index) => (
                  <Pressable
                    key={String(opt.id)}
                    onPress={() => select(opt.id)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: opt.id === value }}
                    className={`flex-row items-center justify-between ${index > 0 ? 'border-t border-neutral-100' : ''} ${
                      opt.id === value ? 'bg-[#FBF9F6]' : 'bg-white'
                    }`}
                    style={{ minHeight: MIN_TOUCH, paddingHorizontal: space(12), paddingVertical: space(9), gap: space(8) }}
                  >
                    <AppText
                      variant="label"
                      className={`font-sans flex-1 ${opt.id === value ? 'font-bold text-[#1A1A1A]' : 'text-neutral-700'}`}
                    >
                      {opt.label}
                    </AppText>
                    {opt.id === value && (
                      <View className="shrink-0">
                        <Check size={Math.round(14 * scale)} color="#1A1A1A" />
                      </View>
                    )}
                  </Pressable>
                ))
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}
