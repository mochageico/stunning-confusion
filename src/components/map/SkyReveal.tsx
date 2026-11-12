import React, { useEffect, useState } from 'react';
import { AccessibilityInfo, Pressable } from 'react-native';
import { Circle, G, Line } from 'react-native-svg';
import { Sparkles } from 'lucide-react-native';

import { AppText, useScaledSpace } from '../design';
import { STAR_RADIUS, type Pt } from '../../lib/mapLayout';
import { SKY } from './skyPalette';

// ============================================================================
// THE REVEAL MOMENT AND THE PAYOFF (CONSTELLATION_SKY_PLAN.md, stage 4)
// ----------------------------------------------------------------------------
// When a verse is learned, the stars joined to it appear. On opening My sky (or
// when a save lands while it is open) each new star plays a short reveal: its
// line draws in from the learned star, then the star lights with a soft ring
// that pulses once or twice, and a banner says "A new star appeared". When the
// last star of a constellation is found, its lines draw in once more in gold
// and stay gold. Drawn as an SVG overlay inside the map's camera (so it is in
// map units), driven by a clock that repaints only this overlay; the map itself
// repaints just once when the new star is released. With reduce-motion on
// there is no animation: the star is simply there, with the banner.
// ============================================================================

/** The reveal's length, in ms. The line draws over its first part; the ring pulses after. */
export const REVEAL_MS = 1500;
/** The share of the reveal after which the new star is let out (the line has finished drawing). */
export const REVEAL_RELEASE = 0.45;
/** The gold lines' draw-in, in ms. */
export const PAYOFF_MS = 1400;

/** Whether the phone asks for less motion. False until it answers (and where it can't say). */
export function useReduceMotion(): boolean {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let live = true;
    AccessibilityInfo.isReduceMotionEnabled?.()
      .then((v) => live && setReduce(!!v))
      .catch(() => {});
    const sub = AccessibilityInfo.addEventListener?.('reduceMotionChanged', (v: boolean) => setReduce(!!v));
    return () => {
      live = false;
      sub?.remove?.();
    };
  }, []);
  return reduce;
}

/**
 * 0 → 1 over `ms`, linear, restarting when `token` changes to a new non-null
 * value. Reads 1 when `token` is null, and 0 in the very render a new token
 * arrives (so nothing flashes at its end state first).
 */
export function useClock(token: object | null, ms: number): number {
  const [state, setState] = useState<{ token: object | null; t: number }>({ token: null, t: 1 });
  useEffect(() => {
    if (token === null) return;
    let raf = 0;
    const start = Date.now();
    const step = () => {
      const t = Math.min(1, (Date.now() - start) / ms);
      setState({ token, t });
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [token, ms]);
  if (token === null) return 1;
  return state.token === token ? state.t : 0;
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));
const along = (a: Pt, b: Pt, k: number): Pt => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];

export interface RevealStar {
  /** Map key of the new star. */
  key: string;
  /** Map key of the learned star its line draws in from, if any. */
  fromKey: string | null;
}

/**
 * The reveal, over the map: for each new star, its line drawing in and then a
 * soft ring that pulses and fades. `t` is the reveal's clock (0..1).
 */
export const RevealOverlay = React.memo(function RevealOverlay({ stars, positions, t }: { stars: RevealStar[]; positions: Record<string, Pt>; t: number }) {
  if (t >= 1 || stars.length === 0) return null;
  const draw = clamp01(t / REVEAL_RELEASE);
  const after = clamp01((t - REVEAL_RELEASE) / (1 - REVEAL_RELEASE));
  // Two soft pulses while the ring fades out.
  const pulse = (1 - Math.cos(after * Math.PI * 4)) / 2;
  const fade = 1 - after * after;
  return (
    <G>
      {stars.map((s) => {
        const to = positions[s.key];
        if (!to) return null;
        const from = s.fromKey ? positions[s.fromKey] : null;
        const tip = from ? along(from, to, draw) : to;
        return (
          <G key={s.key}>
            {from && t < REVEAL_RELEASE + 0.1 ? (
              <Line x1={from[0]} y1={from[1]} x2={tip[0]} y2={tip[1]} stroke={SKY.next} strokeWidth={2.2} strokeOpacity={0.95} strokeLinecap="round" />
            ) : null}
            {draw >= 1 ? (
              <>
                <Circle cx={to[0]} cy={to[1]} r={STAR_RADIUS + 5 + pulse * 9} fill="none" stroke={SKY.next} strokeWidth={2} strokeOpacity={0.35 * fade} />
                <Circle cx={to[0]} cy={to[1]} r={STAR_RADIUS + 4 + pulse * 3} fill={SKY.next} fillOpacity={0.12 * fade} stroke={SKY.next} strokeWidth={1.6} strokeOpacity={0.9 * fade} />
              </>
            ) : null}
          </G>
        );
      })}
    </G>
  );
});

/**
 * The payoff, over the map: every line of a constellation just completed draws
 * in again in gold, one after another. `t` is the payoff's clock (0..1); when
 * it ends the map's own gold lines take over.
 */
export const PayoffOverlay = React.memo(function PayoffOverlay({ lines, positions, t, color }: { lines: { from: string; to: string }[]; positions: Record<string, Pt>; t: number; color: string }) {
  if (t >= 1 || lines.length === 0) return null;
  const n = lines.length;
  return (
    <G>
      {lines.map((l, i) => {
        const a = positions[l.from];
        const b = positions[l.to];
        if (!a || !b) return null;
        // Each line starts a little after the one before and takes a fifth of the time.
        const k = clamp01((t - (i / n) * 0.8) / 0.2);
        if (k <= 0) return null;
        const tip = along(a, b, k);
        return <Line key={`${l.from}~${l.to}`} x1={a[0]} y1={a[1]} x2={tip[0]} y2={tip[1]} stroke={color} strokeWidth={2.4} strokeLinecap="round" />;
      })}
    </G>
  );
});

/** "A new star appeared · John 10:14 · tap it to read", over the top of the sky. Tap opens the star. */
export function RevealBanner({ text, onPress }: { text: string; onPress: () => void }) {
  const space = useScaledSpace();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={text}
      className="flex-row items-center active:opacity-70"
      style={{
        position: 'absolute',
        top: space(10),
        left: space(10),
        right: space(64),
        gap: space(8),
        paddingVertical: space(10),
        paddingHorizontal: space(12),
        borderRadius: 14,
        backgroundColor: SKY.bgSoft,
        borderWidth: 1,
        borderColor: SKY.next,
      }}
    >
      <Sparkles size={16} color={SKY.next} />
      <AppText variant="caption" className="font-sans font-semibold flex-1" style={{ color: SKY.ink }}>
        {text}
      </AppText>
    </Pressable>
  );
}
