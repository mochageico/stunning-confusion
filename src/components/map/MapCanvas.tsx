import React, { forwardRef, useEffect, useImperativeHandle, useState } from 'react';
import { Platform, View } from 'react-native';
import Svg, { G } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  clamp,
  Easing,
  runOnJS,
  useAnimatedProps,
  useAnimatedReaction,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import type { Rect } from '../../lib/mapLayout';

// ============================================================================
// The map's camera: pinch, pan and tap over an SVG drawing.
//
// The SVG is only as big as the box on screen. What moves is one group
// inside it, whose transform (screen = t + zoom * map) is set on the UI
// thread every frame, so the drawing stays sharp at any zoom and a big map
// never becomes one huge bitmap. Native SVG groups take that transform as a
// `matrix` prop; on the web it's the `transform` attribute.
//
// Taps are worked out here only as far as "this map point, at this zoom";
// what was hit is mapModel.hitTest's job.
// ============================================================================

const AnimatedG = Animated.createAnimatedComponent(G);
const IS_WEB = Platform.OS === 'web';

export const MAX_ZOOM = 3;
/** Below this zoom, star names and line labels are left off (they'd be specks). */
export const LABEL_ZOOM = 0.55;
/** Framing never zooms in past this: a two-star constellation shouldn't fill the screen. */
const FRAME_MAX_ZOOM = 1.6;
/** At least this much of the map stays on screen, so it can't be flung away and lost. */
const KEEP_ON_SCREEN = 80;
const FRAME_MS = 480;

export interface MapCamera {
  /** Animates the view to show this map rectangle, clear of the given screen insets. */
  frame: (rect: Rect, insets?: { top?: number; bottom?: number }, instant?: boolean) => void;
  /**
   * Pans (no zoom change) so these map points sit clear of the bottom inset
   * and the sides. The first one (the tapped star) wins if they can't all fit.
   */
  reveal: (points: [number, number][], bottomInset: number) => void;
  /** Zooms by this factor around the middle of the box (the + and − buttons). */
  zoomBy: (factor: number) => void;
}

interface Props {
  /** The whole map's rectangle: pan limits and the smallest zoom. */
  bounds: Rect;
  onTap: (x: number, y: number, zoom: number) => void;
  /** The box was measured (or changed size). */
  onSize?: (w: number, h: number) => void;
  /** Called when labels should appear or vanish as the zoom crosses LABEL_ZOOM. */
  onLabelsChange?: (show: boolean) => void;
  children: React.ReactNode;
}

export const MapCanvas = forwardRef<MapCamera, Props>(function MapCanvas({ bounds, onTap, onSize, onLabelsChange, children }, ref) {
  // layout-ok: measured size, not a style
  const [box, setBox] = useState({ w: 0, h: 0 });

  const zoom = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const boxW = useSharedValue(0);
  const boxH = useSharedValue(0);
  const bx = useSharedValue(bounds.x);
  const by = useSharedValue(bounds.y);
  const bw = useSharedValue(bounds.w);
  const bh = useSharedValue(bounds.h);
  useEffect(() => {
    bx.value = bounds.x;
    by.value = bounds.y;
    bw.value = bounds.w;
    bh.value = bounds.h;
  }, [bounds.x, bounds.y, bounds.w, bounds.h]);

  // Gesture starting points.
  const z0 = useSharedValue(1);
  const tx0 = useSharedValue(0);
  const ty0 = useSharedValue(0);
  const fx0 = useSharedValue(0);
  const fy0 = useSharedValue(0);

  /** Small enough to see the whole map with room around it, never above 1. */
  const minZoom = () => {
    'worklet';
    if (!boxW.value || !bw.value) return 0.2;
    const fit = Math.min(boxW.value / bw.value, boxH.value / Math.max(bh.value, 1));
    return Math.max(0.12, Math.min(1, fit * 0.7));
  };

  /** Keeps some of the map on screen whatever the pan. */
  const clampT = (t: number, z: number, start: number, size: number, view: number) => {
    'worklet';
    const lo = KEEP_ON_SCREEN - (start + size) * z;
    const hi = view - KEEP_ON_SCREEN - start * z;
    return lo > hi ? (lo + hi) / 2 : clamp(t, lo, hi);
  };

  const pinch = Gesture.Pinch()
    .onStart((e) => {
      z0.value = zoom.value;
      tx0.value = tx.value;
      ty0.value = ty.value;
      fx0.value = e.focalX;
      fy0.value = e.focalY;
    })
    .onUpdate((e) => {
      const z = clamp(z0.value * e.scale, minZoom(), MAX_ZOOM);
      // The map point that was under the fingers stays under them, and moving
      // both fingers together drags the map too.
      const mx = (fx0.value - tx0.value) / z0.value;
      const my = (fy0.value - ty0.value) / z0.value;
      zoom.value = z;
      tx.value = clampT(e.focalX - mx * z, z, bx.value, bw.value, boxW.value);
      ty.value = clampT(e.focalY - my * z, z, by.value, bh.value, boxH.value);
    });

  const pan = Gesture.Pan()
    .maxPointers(1)
    .minDistance(6)
    .onStart(() => {
      tx0.value = tx.value;
      ty0.value = ty.value;
    })
    .onUpdate((e) => {
      tx.value = clampT(tx0.value + e.translationX, zoom.value, bx.value, bw.value, boxW.value);
      ty.value = clampT(ty0.value + e.translationY, zoom.value, by.value, bh.value, boxH.value);
    });

  const tap = Gesture.Tap()
    .maxDistance(12)
    .onEnd((e, success) => {
      if (!success) return;
      runOnJS(onTap)((e.x - tx.value) / zoom.value, (e.y - ty.value) / zoom.value, zoom.value);
    });

  const gesture = Gesture.Race(Gesture.Simultaneous(pinch, pan), tap);

  const animatedProps = useAnimatedProps(() => {
    const z = zoom.value;
    return IS_WEB
      ? ({ transform: `matrix(${z} 0 0 ${z} ${tx.value} ${ty.value})` } as object)
      : ({ matrix: [z, 0, 0, z, tx.value, ty.value] } as object);
  });

  useAnimatedReaction(
    () => zoom.value >= LABEL_ZOOM,
    (show, before) => {
      if (before !== null && show !== before && onLabelsChange) runOnJS(onLabelsChange)(show);
    }
  );

  const timing = { duration: FRAME_MS, easing: Easing.out(Easing.cubic) };

  useImperativeHandle(ref, () => ({
    frame(rect, insets = {}, instant = false) {
      const w = boxW.value;
      const h = boxH.value;
      if (!w || !h) return;
      const top = insets.top ?? 0;
      const bottom = insets.bottom ?? 0;
      const pad = 16;
      const availH = Math.max(h - top - bottom - 2 * pad, 80);
      const z = Math.min(Math.max(Math.min((w - 2 * pad) / rect.w, availH / rect.h), 0.12), FRAME_MAX_ZOOM);
      const ntx = w / 2 - (rect.x + rect.w / 2) * z;
      const nty = top + pad + availH / 2 - (rect.y + rect.h / 2) * z;
      if (instant) {
        zoom.value = z;
        tx.value = ntx;
        ty.value = nty;
      } else {
        zoom.value = withTiming(z, timing);
        tx.value = withTiming(ntx, timing);
        ty.value = withTiming(nty, timing);
      }
      onLabelsChange?.(z >= LABEL_ZOOM);
    },
    reveal(points, bottomInset) {
      if (!points.length) return;
      const z = zoom.value;
      // Room for a label under each point, and off the zoom buttons' edge.
      const top = 36;
      const bottom = Math.max(boxH.value - bottomInset - 44, top);
      const left = 60;
      const right = boxW.value - 60;
      const shift = (lo: number, hi: number, min: number, max: number, first: number) => {
        let d = 0;
        if (hi > max) d = max - hi;
        if (lo + d < min) d = min - lo;
        // Never at the cost of the tapped star.
        if (first + d > max) d = max - first;
        if (first + d < min) d = min - first;
        return d;
      };
      const ys = points.map((p) => ty.value + p[1] * z);
      const xs = points.map((p) => tx.value + p[0] * z);
      const dy = shift(Math.min(...ys), Math.max(...ys), top, bottom, ys[0]);
      const dx = shift(Math.min(...xs), Math.max(...xs), left, right, xs[0]);
      if (dy) ty.value = withTiming(ty.value + dy, timing);
      if (dx) tx.value = withTiming(tx.value + dx, timing);
    },
    zoomBy(factor) {
      const z = clamp(zoom.value * factor, minZoom(), MAX_ZOOM);
      const cx = boxW.value / 2;
      const cy = boxH.value / 2;
      const mx = (cx - tx.value) / zoom.value;
      const my = (cy - ty.value) / zoom.value;
      zoom.value = withTiming(z, timing);
      tx.value = withTiming(clampT(cx - mx * z, z, bx.value, bw.value, boxW.value), timing);
      ty.value = withTiming(clampT(cy - my * z, z, by.value, bh.value, boxH.value), timing);
      onLabelsChange?.(z >= LABEL_ZOOM);
    },
  }));

  return (
    <GestureDetector gesture={gesture}>
      <View
        style={{ flex: 1, overflow: 'hidden' }}
        collapsable={false}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          boxW.value = width;
          boxH.value = height;
          setBox({ w: width, h: height });
          onSize?.(width, height);
        }}
      >
        {box.w > 0 && (
          <Svg width={box.w} height={box.h}>
            <AnimatedG animatedProps={animatedProps}>{children}</AnimatedG>
          </Svg>
        )}
      </View>
    </GestureDetector>
  );
});
