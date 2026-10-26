import React from 'react';
import { Circle, G, Line, Text as SvgText } from 'react-native-svg';

import type { ThemeColors } from '../theme';
import { LABEL_GAP, LABEL_HEIGHT, LayoutResult, Pt, STAR_RADIUS, starLabel } from '../../lib/mapLayout';
import type { VerseStage } from '../../lib/stageProgress';
import type { EchoView, FoundEcho, StarLook } from './mapModel';

// ============================================================================
// What the map draws, in map units (the camera scales it). Ink on paper in
// light mode, a night sky in dark: every color is a theme token, and stage
// colors appear only as the ring around a lit star (theme-token rules).
//
// Labels sit centered under each star -- the boxes the layout keeps apart
// assume exactly that -- with a halo in the map's own color, since a line
// leaving a star downward crosses its label.
// ============================================================================

const LABEL_FONT = 'Inter_500Medium';
const LABEL_SIZE = 11;

export function stageRing(palette: ThemeColors, stage: VerseStage): string {
  switch (stage) {
    case 'learning':
      return palette.stageLearning;
    case 'daily':
      return palette.stageDaily;
    case 'weekly':
      return palette.stageWeekly;
    case 'monthly':
      return palette.stageMonthly;
    default:
      // Complete has no stage token (it's ink everywhere else too).
      return palette.ink;
  }
}

/** A label with a halo, centered under the point. */
function Label({ x, y, text, color, halo, italic }: { x: number; y: number; text: string; color: string; halo: string; italic?: boolean }) {
  const ty = y + STAR_RADIUS + LABEL_GAP + LABEL_HEIGHT - 3;
  const common = {
    x,
    y: ty,
    fontSize: LABEL_SIZE,
    fontFamily: LABEL_FONT,
    fontStyle: italic ? ('italic' as const) : undefined,
    textAnchor: 'middle' as const,
  };
  return (
    <>
      <SvgText {...common} stroke={halo} strokeWidth={4} strokeLinejoin="round" fill={halo}>
        {text}
      </SvgText>
      <SvgText {...common} fill={color}>
        {text}
      </SvgText>
    </>
  );
}

/**
 * The user's words on a line: along it, just above, like a road name on a
 * map -- set flat between the stars, it would land on their names.
 */
function LineLabel({ a, b, text, color, halo }: { a: Pt; b: Pt; text: string; color: string; halo: string }) {
  let angle = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  if (angle > 90) angle -= 180;
  if (angle < -90) angle += 180;
  const mx = (a[0] + b[0]) / 2;
  const my = (a[1] + b[1]) / 2;
  const common = { x: 0, y: -6, fontSize: LABEL_SIZE, fontFamily: LABEL_FONT, fontStyle: 'italic' as const, textAnchor: 'middle' as const };
  return (
    <G transform={`translate(${mx} ${my}) rotate(${angle})`}>
      <SvgText {...common} stroke={halo} strokeWidth={4} strokeLinejoin="round" fill={halo}>
        {text}
      </SvgText>
      <SvgText {...common} fill={color}>
        {text}
      </SvgText>
    </G>
  );
}

interface DrawingProps {
  result: LayoutResult;
  positions: Record<string, Pt>;
  /** Stars that are growing in (0..1), from the move animation. */
  appear: Record<string, number>;
  looks: Record<string, StarLook>;
  found: FoundEcho[];
  lineLabels: Record<string, string>;
  showLabels: boolean;
  selectedKey: string | null;
  selectedLine: string | null;
  /** Empty state: the curated shapes drawn faint. */
  dim: boolean;
  palette: ThemeColors;
  /** The map's background, for label halos. */
  paper: string;
}

/** Everything but the ghosts. Memoized: the camera moving never redraws it. */
export const MapDrawing = React.memo(function MapDrawing({
  result,
  positions,
  appear,
  looks,
  found,
  lineLabels,
  showLabels,
  selectedKey,
  selectedLine,
  dim,
  palette,
  paper,
}: DrawingProps) {
  const lit = (k: string) => looks[k]?.lit ?? false;
  return (
    <G opacity={dim ? 0.5 : 1}>
      {/* Lines first, under the stars. Brighter where both ends are lit. */}
      {result.lines.map((l) => {
        const a = positions[l.from];
        const b = positions[l.to];
        if (!a || !b) return null;
        const both = lit(l.from) && lit(l.to);
        const chosen = selectedLine === `${l.from}~${l.to}`;
        const fade = Math.min(appear[l.from] ?? 1, appear[l.to] ?? 1);
        return (
          <Line
            key={`${l.id}:${l.from}~${l.to}`}
            x1={a[0]}
            y1={a[1]}
            x2={b[0]}
            y2={b[1]}
            stroke={chosen ? palette.accent : both ? palette.ink2 : palette.ink3}
            strokeWidth={chosen ? 3 : both ? 1.6 : 1.2}
            strokeOpacity={(both || chosen ? 1 : 0.6) * fade}
            strokeLinecap="round"
          />
        );
      })}

      {/* Echoes found for good: both ends held. Dotted, so they never read as a link. */}
      {found.map((f) => {
        const a = positions[f.from];
        const b = positions[f.to];
        if (!a || !b) return null;
        return (
          <Line
            key={`echo:${f.id}`}
            x1={a[0]}
            y1={a[1]}
            x2={b[0]}
            y2={b[1]}
            stroke={palette.ink3}
            strokeWidth={2}
            strokeOpacity={0.8}
            strokeDasharray="0.1 6"
            strokeLinecap="round"
          />
        );
      })}

      {/* The user's own words on a line, at its middle. */}
      {showLabels &&
        result.lines.map((l) => {
          const text = lineLabels[`${l.from}~${l.to}`];
          const a = positions[l.from];
          const b = positions[l.to];
          if (!text || !a || !b) return null;
          return <LineLabel key={`ll:${l.from}~${l.to}`} a={a} b={b} text={text} color={palette.ink2} halo={paper} />;
        })}

      {result.stars.map((s) => {
        const p = positions[s.key];
        if (!p) return null;
        const look = looks[s.key];
        const grow = appear[s.key] ?? 1;
        const selected = selectedKey === s.key;
        return (
          <G key={s.key} opacity={grow}>
            {selected && <Circle cx={p[0]} cy={p[1]} r={18} fill={palette.accent} fillOpacity={0.16} stroke={palette.accent} strokeWidth={1.5} />}
            {look?.lit ? (
              <>
                {/* A soft glow: stars on paper by day, in the sky by night. */}
                <Circle cx={p[0]} cy={p[1]} r={13} fill={palette.ink} fillOpacity={0.07} />
                <Circle cx={p[0]} cy={p[1]} r={STAR_RADIUS + 3} fill="none" stroke={stageRing(palette, look.stage!)} strokeWidth={2.5} />
                <Circle cx={p[0]} cy={p[1]} r={STAR_RADIUS - 1.5} fill={palette.ink} />
              </>
            ) : (
              <>
                {look?.suggested && (
                  <Circle cx={p[0]} cy={p[1]} r={STAR_RADIUS + 5} fill="none" stroke={palette.accent} strokeWidth={1.5} strokeDasharray="3 3" />
                )}
                <Circle cx={p[0]} cy={p[1]} r={STAR_RADIUS - 1} fill={paper} stroke={palette.ink3} strokeWidth={1.5} />
              </>
            )}
            {showLabels && (
              <Label x={p[0]} y={p[1]} text={s.label} color={look?.lit ? palette.ink : palette.ink3} halo={paper} />
            )}
          </G>
        );
      })}
    </G>
  );
});

/**
 * A tapped star's echoes: a ghost star (faint, dashed) for an end that isn't on
 * the map, and a dotted line out to it -- or to the other end's star when it is
 * on the map but not found yet. Fades with `opacity`.
 */
export const EchoGhosts = React.memo(function EchoGhosts({
  from,
  views,
  positions,
  opacity,
  showLabels,
  palette,
  paper,
}: {
  from: Pt | null;
  views: EchoView[];
  positions: Record<string, Pt>;
  opacity: number;
  showLabels: boolean;
  palette: ThemeColors;
  paper: string;
}) {
  if (!from || opacity <= 0) return null;
  return (
    <G opacity={opacity}>
      {views.map((v, i) => {
        if (v.found) return null;
        const to = v.ghost ?? (v.thereKey ? positions[v.thereKey] : null);
        if (!to) return null;
        return (
          <G key={i}>
            <Line x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]} stroke={palette.ink3} strokeWidth={1.6} strokeDasharray="0.1 6" strokeLinecap="round" />
            {v.ghost && (
              <>
                <Circle cx={to[0]} cy={to[1]} r={STAR_RADIUS} fill={paper} stroke={palette.ink3} strokeWidth={1.5} strokeDasharray="2.5 2.5" />
                {showLabels && <Label x={to[0]} y={to[1]} text={starLabel(v.there)} color={palette.ink3} halo={paper} italic />}
              </>
            )}
          </G>
        );
      })}
    </G>
  );
});
