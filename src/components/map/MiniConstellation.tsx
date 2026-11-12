import React, { useId, useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Defs, Line, RadialGradient, Stop } from 'react-native-svg';

import type { Constellation, QueueItem } from '../../types';
import { starLit } from '../../lib/constellations';
import { useThemeColors } from '../theme';
import { SKY } from './skyPalette';

// ============================================================================
// MiniConstellation -- a constellation drawn small, from its 0-100 coordinates
// (CONSTELLATION_SKY_PLAN.md, stage 2). Used by the browse page's cards and
// "My sky" tile and by the preview page's big drawing.
//
//   showing + held     accent-filled star
//   showing, not held  hollow star (outlined)
//   hidden             a soft glow (RadialGradient circles, no SVG filter, so
//                      iOS, Android and web all look the same); no lines to it
//
// A line is drawn only when both of its ends show. `night` paints it on a dark
// sky whatever the theme is (the "My sky" tile is always night); otherwise it
// follows the app's theme tokens.
// ============================================================================

const PAD = 10;
const VIEW = 100;

export interface MiniConstellationProps {
  constellation: Constellation;
  /** Star ids showing now (revealedStars). */
  revealed: ReadonlySet<string>;
  queue: QueueItem[];
  /** Paint on the always-dark night sky instead of the theme's surface. */
  night?: boolean;
  /** Pixel width; the drawing keeps the constellation's own proportions. */
  width: number;
  /** Pixel height. Defaults to the width. */
  height?: number;
  /** Star radius in drawing units (of 100). Defaults to 4. */
  starSize?: number;
}

export function MiniConstellation({ constellation, revealed, queue, night = false, width, height, starSize = 4 }: MiniConstellationProps) {
  const palette = useThemeColors();
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const h = height ?? width;

  const ink = night ? SKY.ink : palette.ink;
  const lineColor = night ? SKY.ink3 : palette.ink3;
  const filled = night ? SKY.ink : palette.accent;
  const glow = night ? SKY.glow : palette.accent;

  // Fit the stars' own bounds into the box, keeping their proportions.
  const pos = useMemo(() => {
    const xs = constellation.stars.map((s) => s.x);
    const ys = constellation.stars.map((s) => s.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const w = Math.max(maxX - minX, 1);
    const hh = Math.max(maxY - minY, 1);
    const inner = VIEW - 2 * PAD;
    const k = Math.min(inner / w, inner / hh);
    const ox = PAD + (inner - w * k) / 2;
    const oy = PAD + (inner - hh * k) / 2;
    const map = new Map<string, [number, number]>();
    for (const s of constellation.stars) map.set(s.id, [ox + (s.x - minX) * k, oy + (s.y - minY) * k]);
    return map;
  }, [constellation]);

  const gradId = `glow${uid}`;
  const lit = (id: string) => {
    const s = constellation.stars.find((x) => x.id === id);
    return !!s && starLit(s.ref, queue);
  };

  return (
    <View style={{ width, height: h }} pointerEvents="none">
      <Svg width={width} height={h} viewBox={`0 0 ${VIEW} ${VIEW}`} preserveAspectRatio="xMidYMid meet">
        <Defs>
          <RadialGradient id={gradId} cx="50%" cy="50%" r="50%">
            <Stop offset="0" stopColor={glow} stopOpacity={0.55} />
            <Stop offset="0.5" stopColor={glow} stopOpacity={0.2} />
            <Stop offset="1" stopColor={glow} stopOpacity={0} />
          </RadialGradient>
        </Defs>

        {constellation.lines.map((l, i) => {
          const a = pos.get(l.from);
          const b = pos.get(l.to);
          if (!a || !b || !revealed.has(l.from) || !revealed.has(l.to)) return null;
          return <Line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]} stroke={lineColor} strokeWidth={1.2} strokeLinecap="round" opacity={0.85} />;
        })}

        {constellation.stars.map((s) => {
          const p = pos.get(s.id);
          if (!p) return null;
          if (!revealed.has(s.id)) {
            return <Circle key={s.id} cx={p[0]} cy={p[1]} r={starSize * 2.6} fill={`url(#${gradId})`} />;
          }
          return lit(s.id) ? (
            <Circle key={s.id} cx={p[0]} cy={p[1]} r={starSize} fill={filled} />
          ) : (
            <Circle key={s.id} cx={p[0]} cy={p[1]} r={starSize * 0.85} fill="none" stroke={ink} strokeWidth={1.4} />
          );
        })}
      </Svg>
    </View>
  );
}

export default MiniConstellation;
