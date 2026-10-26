import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useState } from 'react';
import { Platform, View } from 'react-native';
import Svg, { G } from 'react-native-svg';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  cancelAnimation,
  clamp,
  Easing,
  runOnJS,
  useAnimatedStyle,
  useAnimatedReaction,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';

import type { Rect } from '../../lib/mapLayout';

// ============================================================================
// The map's camera: pinch, pan and tap over an SVG drawing.
//
// The drawing is painted once at a "baked" camera, a little bigger than the
// box so a short pan doesn't show its edge. While a finger moves or the camera
// slides, only the finished picture is moved and scaled (a native view
// transform, which costs the phone almost nothing); repainting every star and
// dotted line each frame is what made the map stutter. When the camera comes
// to rest, the drawing is painted again at the new camera, sharp. Native SVG
// groups take the baked transform as a `matrix` prop; on the web it's `transform`.
//
// Taps are worked out here only as far as "this map point, at this zoom";
// what was hit is mapModel.hitTest's job.
// ============================================================================

const IS_WEB = Platform.OS === 'web';

export const MAX_ZOOM = 3;
/** Below this zoom, star names and line labels are left off (they'd be specks). */
export const LABEL_ZOOM = 0.55;
/** Framing never zooms in past this: a two-star constellation shouldn't fill the screen. */
const FRAME_MAX_ZOOM = 1.6;
/** At least this much of the map stays on screen, so it can't be flung away and lost. */
const KEEP_ON_SCREEN = 80;
const FRAME_MS = 480;
/** How much extra drawing is painted past each edge of the box, as a share of the box. */
const OVERSCAN = 0.4;

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
  // The camera the drawing was last painted at.
  // layout-ok: camera state, not a style
  const [baked, setBaked] = useState({ z: 1, tx: 0, ty: 0 });

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
  const s0 = useSharedValue(1);
  const n0 = useSharedValue(0);
  // Fingers on the map right now. A camera slide (reveal) waits while it's above 0, so it can't fight a drag.
  const touches = useSharedValue(0);
  const tx0 = useSharedValue(0);
  const ty0 = useSharedValue(0);
  const fx0 = useSharedValue(0);
  const fy0 = useSharedValue(0);
  // The baked camera, mirrored for the UI thread once the repaint is committed.
  const bz = useSharedValue(1);
  const btx = useSharedValue(0);
  const bty = useSharedValue(0);
  useLayoutEffect(() => {
    bz.value = baked.z;
    btx.value = baked.tx;
    bty.value = baked.ty;
  }, [baked]);

  const bake = (z: number, x: number, y: number) => {
    setBaked((b) => (b.z === z && b.tx === x && b.ty === y ? b : { z, tx: x, ty: y }));
  };
  /** Repaints at the camera as it is now, once nothing is moving it. */
  const settle = () => {
    'worklet';
    if (touches.value > 0) return;
    runOnJS(bake)(zoom.value, tx.value, ty.value);
  };

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

  /** A touch stops any camera slide still running, like catching a scrolling page. */
  const catchCamera = () => {
    'worklet';
    cancelAnimation(zoom);
    cancelAnimation(tx);
    cancelAnimation(ty);
  };

  /** Starts (or restarts) the pinch from where the map is now, with these fingers. */
  const anchorPinch = (scale: number, focalX: number, focalY: number, pointers: number) => {
    'worklet';
    z0.value = zoom.value;
    s0.value = scale;
    tx0.value = tx.value;
    ty0.value = ty.value;
    fx0.value = focalX;
    fy0.value = focalY;
    n0.value = pointers;
  };

  const pinch = Gesture.Pinch()
    .onBegin(() => {
      touches.value += 1;
      catchCamera();
    })
    .onStart((e) => {
      anchorPinch(e.scale, e.focalX, e.focalY, e.numberOfPointers);
    })
    .onUpdate((e) => {
      // One finger lifting (or a third landing) moves the pinch's center to a different finger. Start again from here rather than let the map jump with it.
      if (e.numberOfPointers !== n0.value) {
        anchorPinch(e.scale, e.focalX, e.focalY, e.numberOfPointers);
        return;
      }
      if (e.numberOfPointers < 2) return;
      const z = clamp(z0.value * (e.scale / s0.value), minZoom(), MAX_ZOOM);
      // The map point that was under the fingers stays under them, and moving
      // both fingers together drags the map too.
      const mx = (fx0.value - tx0.value) / z0.value;
      const my = (fy0.value - ty0.value) / z0.value;
      zoom.value = z;
      tx.value = clampT(e.focalX - mx * z, z, bx.value, bw.value, boxW.value);
      ty.value = clampT(e.focalY - my * z, z, by.value, bh.value, boxH.value);
    })
    .onFinalize(() => {
      touches.value = Math.max(0, touches.value - 1);
      settle();
    });

  const pan = Gesture.Pan()
    .maxPointers(1)
    .minDistance(6)
    .onBegin(() => {
      touches.value += 1;
      catchCamera();
    })
    .onStart(() => {
      tx0.value = tx.value;
      ty0.value = ty.value;
    })
    .onUpdate((e) => {
      tx.value = clampT(tx0.value + e.translationX, zoom.value, bx.value, bw.value, boxW.value);
      ty.value = clampT(ty0.value + e.translationY, zoom.value, by.value, bh.value, boxH.value);
    })
    .onFinalize(() => {
      touches.value = Math.max(0, touches.value - 1);
      settle();
    });

  const tap = Gesture.Tap()
    .maxDistance(12)
    .onEnd((e, success) => {
      if (!success) return;
      runOnJS(onTap)((e.x - tx.value) / zoom.value, (e.y - ty.value) / zoom.value, zoom.value);
    });

  const gesture = Gesture.Race(Gesture.Simultaneous(pinch, pan), tap);

  // Moves the painted picture from the baked camera to the live one.
  // Screen point = tx + zoom * map; the picture holds it at btx + bz * map,
  // shifted by the overscan margin, and RN scales about the view's center.
  const ox = box.w * OVERSCAN;
  const oy = box.h * OVERSCAN;
  const pictureStyle = useAnimatedStyle(() => {
    const s = zoom.value / bz.value;
    const mx = boxW.value * OVERSCAN;
    const my = boxH.value * OVERSCAN;
    const cx = boxW.value / 2 + mx;
    const cy = boxH.value / 2 + my;
    return {
      transform: [
        { translateX: tx.value + mx - cx - s * (mx + btx.value - cx) },
        { translateY: ty.value + my - cy - s * (my + bty.value - cy) },
        { scale: s },
      ],
    };
  });
  const bakedMatrix = IS_WEB
    ? { transform: `matrix(${baked.z} 0 0 ${baked.z} ${baked.tx + ox} ${baked.ty + oy})` }
    : { matrix: [baked.z, 0, 0, baked.z, baked.tx + ox, baked.ty + oy] };

  useAnimatedReaction(
    () => zoom.value >= LABEL_ZOOM,
    (show, before) => {
      if (before !== null && show !== before && onLabelsChange) runOnJS(onLabelsChange)(show);
    }
  );

  const timing = { duration: FRAME_MS, easing: Easing.out(Easing.cubic) };
  const done = (finished?: boolean) => {
    'worklet';
    if (finished) settle();
  };

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
        bake(z, ntx, nty);
      } else {
        zoom.value = withTiming(z, timing, done);
        tx.value = withTiming(ntx, timing);
        ty.value = withTiming(nty, timing);
      }
      onLabelsChange?.(z >= LABEL_ZOOM);
    },
    reveal(points, bottomInset) {
      // A finger on the map is steering it; don't slide the camera under it.
      if (!points.length || touches.value > 0) return;
      const z = zoom.value;
      // Room for a label under each point, and off the zoom buttons' edge.
      const top = 36;
      const bottom = Math.max(boxH.value - bottomInset - 44, top);
      const left = 60;
      const right = boxW.value - 60;
      // A star with a lot of echoes rings itself with ghosts: zoom out until the ring fits (a label's width either side).
      const mxs = points.map((p) => p[0]);
      const mys = points.map((p) => p[1]);
      const spanX = Math.max(...mxs) - Math.min(...mxs) + 96;
      const spanY = Math.max(...mys) - Math.min(...mys) + 48;
      // Fitting the ring can use more of the width than a plain pan: only the zoom buttons' side needs keeping clear.
      const fitLeft = 28;
      const fitRight = boxW.value - 56;
      const fit = Math.min((fitRight - fitLeft) / spanX, (bottom - top) / spanY);
      if (fit < z && points.length > 1) {
        const nz = Math.max(fit, minZoom());
        zoom.value = withTiming(nz, timing, done);
        tx.value = withTiming((fitLeft + fitRight) / 2 - ((Math.min(...mxs) + Math.max(...mxs)) / 2) * nz, timing);
        ty.value = withTiming((top + bottom) / 2 - ((Math.min(...mys) + Math.max(...mys)) / 2) * nz, timing);
        onLabelsChange?.(nz >= LABEL_ZOOM);
        return;
      }
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
      if (dy) ty.value = withTiming(ty.value + dy, timing, dx ? undefined : done);
      if (dx) tx.value = withTiming(tx.value + dx, timing, done);
    },
    zoomBy(factor) {
      const z = clamp(zoom.value * factor, minZoom(), MAX_ZOOM);
      const cx = boxW.value / 2;
      const cy = boxH.value / 2;
      const mx = (cx - tx.value) / zoom.value;
      const my = (cy - ty.value) / zoom.value;
      zoom.value = withTiming(z, timing, done);
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
          <Animated.View style={[{ position: 'absolute', left: -ox, top: -oy, width: box.w + 2 * ox, height: box.h + 2 * oy }, pictureStyle]}>
            <Svg width={box.w + 2 * ox} height={box.h + 2 * oy}>
              <G {...(bakedMatrix as object)}>{children}</G>
            </Svg>
          </Animated.View>
        )}
      </View>
    </GestureDetector>
  );
});
