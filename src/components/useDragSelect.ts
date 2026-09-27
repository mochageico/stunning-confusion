import { useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ScrollView, View } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';

import { applyDragRange, autoScrollSpeed, hitTestIndex, ItemRect } from '../lib/dragSelect';

// ============================================================================
// HOLD-AND-DRAG MULTI-SELECT
// ----------------------------------------------------------------------------
// Press and hold an item, then slide: everything between where you started and
// where your finger is gets selected (or, if you started on an already-
// selected item, deselected). Holding near the top or bottom of the scroll
// area auto-scrolls, so a whole chapter can be selected in one motion.
//
// Wiring, for a screen that uses it:
//   - wrap the items' DIRECT parent in <GestureDetector gesture={gesture}>
//     (the parent needs collapsable={false});
//   - give each item onLayout={itemLayout(index)};
//   - spread scrollProps onto the ScrollView and pass its ref in;
//   - route plain taps through handleTap, so the tap that fires when a drag
//     lifts doesn't flip the last item straight back.
//
// Callbacks run on the JS thread (runOnJS) -- the work per move is a hit test
// over a chapter's worth of rects, well inside a frame.
// ============================================================================

const LONG_PRESS_MS = 300;

interface Options {
  /** Item ids in display order. */
  ids: number[];
  selected: number[];
  setSelected: (next: number[]) => void;
  /** Plain tap on an item (select/deselect just that one). */
  onTap: (id: number) => void;
  scrollRef: React.RefObject<ScrollView | null>;
  /** Pixels at the bottom of the scroll area covered by floating UI -- the
   * auto-scroll zone sits above it, not underneath where the finger can't see. */
  bottomInset?: number;
}

interface DragState {
  anchor: number;
  current: number;
  mode: 'select' | 'deselect';
  initial: number[];
  /** Last finger position, local to the items' parent, and the scroll offset at that moment. */
  x: number;
  y: number;
  scrollAtEvent: number;
  absoluteY: number;
}

export function useDragSelect({ ids, selected, setSelected, onTap, scrollRef, bottomInset = 0 }: Options) {
  const [dragging, setDragging] = useState(false);
  const rects = useRef<(ItemRect | undefined)[]>([]);
  const drag = useRef<DragState | null>(null);
  const scrollY = useRef(0);
  const contentHeight = useRef(0);
  const viewport = useRef({ top: 0, height: 0 });
  const frame = useRef<number | null>(null);
  const suppressTapsUntil = useRef(0);

  // The gesture is built once; its callbacks read current props through this.
  const latest = useRef({ ids, selected, setSelected, bottomInset });
  latest.current = { ids, selected, setSelected, bottomInset };

  const selectUpTo = (localX: number, localY: number) => {
    const d = drag.current;
    if (!d) return;
    const index = hitTestIndex(rects.current, localX, localY);
    if (index < 0 || index === d.current) return;
    d.current = index;
    latest.current.setSelected(applyDragRange(d.initial, latest.current.ids, d.anchor, index, d.mode));
  };

  const tick = () => {
    const d = drag.current;
    if (!d) return;
    const { top, height } = viewport.current;
    const speed = height > 0 ? autoScrollSpeed(d.absoluteY, top, top + height - latest.current.bottomInset) : 0;
    if (speed !== 0) {
      const maxY = Math.max(0, contentHeight.current - height);
      const next = Math.min(maxY, Math.max(0, scrollY.current + speed));
      if (next !== scrollY.current) {
        scrollRef.current?.scrollTo({ y: next, animated: false });
        scrollY.current = next;
        // The finger hasn't moved, but the list has slid under it.
        selectUpTo(d.x, d.y + (next - d.scrollAtEvent));
      }
    }
    frame.current = requestAnimationFrame(tick);
  };

  const endDrag = () => {
    if (!drag.current) return;
    drag.current = null;
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
    setDragging(false);
    suppressTapsUntil.current = Date.now() + 350;
  };

  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(LONG_PRESS_MS)
        .runOnJS(true)
        .onStart((e) => {
          const index = hitTestIndex(rects.current, e.x, e.y);
          if (index < 0) return;
          const { ids: currentIds, selected: currentSelected } = latest.current;
          const mode = currentSelected.includes(currentIds[index]) ? 'deselect' : 'select';
          drag.current = {
            anchor: index,
            current: index,
            mode,
            initial: currentSelected,
            x: e.x,
            y: e.y,
            scrollAtEvent: scrollY.current,
            absoluteY: e.absoluteY,
          };
          suppressTapsUntil.current = Infinity;
          latest.current.setSelected(applyDragRange(currentSelected, currentIds, index, index, mode));
          setDragging(true);
          // On native the ScrollView ref is the view itself and can measure
          // itself (RN's types just don't declare it); on web it's a wrapper
          // component, so fall back to the underlying scrolling node.
          type Measurable = Pick<View, 'measureInWindow'>;
          const ref = scrollRef.current as unknown as
            | (Partial<Measurable> & { getNativeScrollRef?: () => Measurable | null; getScrollableNode?: () => Measurable | null })
            | null;
          const measurable = ref?.measureInWindow ? (ref as Measurable) : ref?.getNativeScrollRef?.() ?? ref?.getScrollableNode?.();
          measurable?.measureInWindow?.((_x, y, _w, h) => {
            viewport.current = { top: y, height: h };
          });
          frame.current = requestAnimationFrame(tick);
        })
        .onUpdate((e) => {
          const d = drag.current;
          if (!d) return;
          d.x = e.x;
          d.y = e.y;
          d.absoluteY = e.absoluteY;
          d.scrollAtEvent = scrollY.current;
          selectUpTo(e.x, e.y);
        })
        .onFinalize(endDrag),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const itemLayout = (index: number) => (e: LayoutChangeEvent) => {
    const { x, y, width, height } = e.nativeEvent.layout;
    rects.current[index] = { x, y, width, height };
  };

  const handleTap = (id: number) => {
    if (Date.now() < suppressTapsUntil.current) return;
    onTap(id);
  };

  const scrollProps = {
    scrollEventThrottle: 16,
    // Belt and braces: the pan gesture already owns the touch once it
    // activates, but freezing the scroll view guarantees the list can't also
    // drag along under the finger. Programmatic auto-scroll still works.
    scrollEnabled: !dragging,
    onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      scrollY.current = e.nativeEvent.contentOffset.y;
    },
    onContentSizeChange: (_w: number, h: number) => {
      contentHeight.current = h;
    },
  };

  return { gesture, itemLayout, handleTap, scrollProps, dragging };
}
