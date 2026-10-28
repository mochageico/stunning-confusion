import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { X } from 'lucide-react-native';
import Svg, { Circle, Line, Text as SvgText } from 'react-native-svg';

import type { QueueItem, VerseState } from '../../types';
import { AppButton, AppIconButton, AppText, useScaledSpace } from '../design';
import { RoundFrame } from '../GradedRecitation';
import { useThemeColors } from '../theme';
import { CONSTELLATIONS } from '../../content/constellations';
import { starLit } from '../../lib/constellations';
import { LayoutResult, STAR_RADIUS, viewBounds } from '../../lib/mapLayout';
import { FORMATS, formatLabel } from '../../lib/formatNames';
import { readMixCounts, MIX_COUNTS_PREF } from '../../lib/mix';
import { loadPracticePrefs } from '../../lib/practicePrefs';
import { starVerses, walkCredit, WalkCredit, walkOrder } from '../../lib/mapWalk';
import WalkRound, { WalkMode, WalkRoundResult } from './WalkRound';
import { GradeInput, wordAccuracy } from '../../lib/grading';

// ============================================================================
// WALK THE CONSTELLATION (CONSTELLATION_PLAN.md, stage 6)
// ----------------------------------------------------------------------------
// Start at a star and follow the lines. The next star shows as a blank circle
// in its place on the map -- the cue is where it sits, not text -- and the
// user recites what's there (WalkRound). Then it fills in and the walk moves
// on. Only stars the user holds are walked to; the rest are passed through.
//
// Counts as a review by default (Settings > Walk the constellation can make it
// practice). Credit is due-gated and quiet, through the same
// handleUpdateVerseStatus path as Pick up the thread, with via: 'map'. A miss
// never penalizes; a self-check is self-reported, never perfect.
// ============================================================================

const MAP_HEIGHT = 230;
const PAD = 40;

type Phase = 'start' | 'walk' | 'done';

export interface WalkDeps {
  handleUpdateVerseStatus: (
    verses: VerseState[],
    status: 'memorized',
    drill: 'speak' | 'type' | 'reveal',
    opts: { perfect: boolean; quiet: boolean; via: 'map'; gradeFor?: (v: VerseState) => GradeInput | undefined; canMoveUp?: boolean }
  ) => Promise<unknown>;
  validateTouch: (item: QueueItem, drill: 'speak' | 'type' | 'reveal') => boolean;
  isReviewDue: (nextReviewDueDate: string | null) => boolean;
  reviewsPaused: boolean;
}

/** The constellation's own map, small, with the walk drawn on it. */
function WalkMap({
  result,
  groupId,
  held,
  visited,
  target,
  start,
  chosen,
  onChoose,
}: {
  result: LayoutResult;
  groupId: string;
  held: Set<string>;
  visited: Set<string>;
  target: string | null;
  start: string | null;
  /** Start screen: stars can be tapped to choose where to begin. */
  chosen?: string | null;
  onChoose?: (key: string) => void;
}) {
  const palette = useThemeColors();
  const group = result.groups.find((g) => g.id === groupId);
  const keys = useMemo(() => new Set(group?.keys ?? []), [group]);
  const b = viewBounds(result, groupId);
  // Labels grow with a wide constellation so they stay about the same on screen.
  const font = Math.max(11, b.w / 22);
  const r = Math.max(STAR_RADIUS, b.w / 60);
  const stars = result.stars.filter((s) => keys.has(s.key));
  const lines = result.lines.filter((l) => keys.has(l.from) && keys.has(l.to));
  return (
    <View className="bg-surface border border-line rounded-card" style={{ height: MAP_HEIGHT, overflow: 'hidden' }}>
      <Svg width="100%" height="100%" viewBox={`${b.x - PAD} ${b.y - PAD / 2} ${b.w + PAD * 2} ${b.h + PAD}`} preserveAspectRatio="xMidYMid meet">
        {lines.map((l) => {
          const a = result.positions[l.from];
          const c = result.positions[l.to];
          if (!a || !c) return null;
          const lit = (visited.has(l.from) || l.from === start) && (visited.has(l.to) || l.to === start);
          return <Line key={`${l.from}~${l.to}`} x1={a[0]} y1={a[1]} x2={c[0]} y2={c[1]} stroke={lit ? palette.ink2 : palette.lineStrong} strokeWidth={lit ? 1.6 : 1} />;
        })}
        {stars.map((s) => {
          const p = result.positions[s.key];
          if (!p) return null;
          const isHeld = held.has(s.key);
          const done = visited.has(s.key) || s.key === start;
          const isTarget = s.key === target;
          const pick = chosen === s.key;
          return (
            <React.Fragment key={s.key}>
              {isTarget ? (
                // The blank circle: where to recite from, with no text.
                <Circle cx={p[0]} cy={p[1]} r={r * 2} fill={palette.surface} stroke={palette.accent} strokeWidth={2} strokeDasharray="5 4" />
              ) : (
                <Circle
                  cx={p[0]}
                  cy={p[1]}
                  r={r}
                  fill={done || pick ? palette.accent : isHeld ? palette.ink3 : palette.surface}
                  stroke={isHeld ? palette.accent : palette.lineStrong}
                  strokeWidth={pick ? 3 : 1.4}
                />
              )}
              {done || pick ? (
                <SvgText x={p[0]} y={p[1] + r + font + 2} fontSize={font} fontFamily="Inter_500Medium" textAnchor="middle" fill={palette.ink}>
                  {s.label}
                </SvgText>
              ) : null}
              {onChoose && isHeld ? <Circle cx={p[0]} cy={p[1]} r={r * 2.4} fill="transparent" onPress={() => onChoose(s.key)} /> : null}
            </React.Fragment>
          );
        })}
      </Svg>
    </View>
  );
}

export default function WalkConstellation({
  result,
  groupId,
  queue,
  deps,
  onClose,
}: {
  result: LayoutResult;
  groupId: string;
  queue: QueueItem[];
  deps: WalkDeps;
  onClose: () => void;
}) {
  const space = useScaledSpace();
  const group = result.groups.find((g) => g.id === groupId);
  const title = CONSTELLATIONS.find((c) => c.id === groupId)?.title ?? 'Your constellation';
  const starsByKey = useMemo(() => new Map(result.stars.map((s) => [s.key, s])), [result]);
  const held = useMemo(() => new Set((group?.keys ?? []).filter((k) => starsByKey.get(k) && starLit(starsByKey.get(k)!.ref, queue))), [group, starsByKey, queue]);

  // Whether the walk counts: the Settings switch, read once when it opens.
  const [counts, setCounts] = useState(FORMATS.walk.counts);
  useEffect(() => {
    loadPracticePrefs().then((saved) => setCounts(readMixCounts(saved[MIX_COUNTS_PREF]).walk));
  }, []);

  const heldKeys = useMemo(() => [...held].sort(), [held]);
  const [phase, setPhase] = useState<Phase>('start');
  const [startKey, setStartKey] = useState<string | null>(heldKeys[0] ?? null);
  const [order, setOrder] = useState<string[]>([]);
  const [step, setStep] = useState(0);
  const [tally, setTally] = useState({ walked: 0, credited: 0, skipped: 0 });
  // A verse counts once per walk.
  const credited = useRef(new Set<string>());
  // The walk's stars are fixed when it starts, so a refresh from a credit can't change the route.
  const frozenQueue = useRef<QueueItem[]>(queue);

  const begin = () => {
    if (!startKey || !group) return;
    const graph = { keys: group.keys, lines: result.lines.filter((l) => group.keys.includes(l.from) && group.keys.includes(l.to)) };
    const o = walkOrder(graph, startKey, (k) => held.has(k));
    frozenQueue.current = queue;
    credited.current = new Set();
    setOrder(o);
    setStep(0);
    setTally({ walked: 0, credited: 0, skipped: 0 });
    setPhase(o.length === 0 ? 'done' : 'walk');
  };

  const targetKey = phase === 'walk' ? order[step] ?? null : null;
  const target = targetKey ? starsByKey.get(targetKey) : undefined;
  const verses = useMemo(() => (target ? starVerses(target.ref, frozenQueue.current) : []), [target]);
  const visited = useMemo(() => new Set(order.slice(0, step)), [order, step]);

  const verseId = (v: { item: QueueItem }) => v.item.verseId;
  const decide = (index: number, passed: boolean, perfect: boolean, mode: WalkMode) => {
    const v = verses[index];
    if (!v) return { kind: null as WalkCredit, label: '' };
    return walkCredit(v.item, {
      counts,
      passed,
      perfect,
      mode,
      paused: deps.reviewsPaused,
      due: deps.isReviewDue(v.item.nextReviewDueDate),
      touchOk: v.item.status === 'learning' ? deps.validateTouch(v.item, mode === 'self' ? 'reveal' : mode) : true,
      alreadyCounted: credited.current.has(verseId(v)),
    });
  };

  const advance = (counted: number, skipped: boolean) => {
    setTally((t) => ({ walked: t.walked + (skipped ? 0 : 1), credited: t.credited + counted, skipped: t.skipped + (skipped ? 1 : 0) }));
    if (step + 1 >= order.length) setPhase('done');
    else setStep(step + 1);
  };

  const finishRound = async (result: WalkRoundResult) => {
    const touches: typeof verses = [];
    const reviews: typeof verses = [];
    result.perVerse.forEach((pv) => {
      const { kind } = decide(pv.index, pv.ok, pv.perfect, result.mode);
      if (!kind) return;
      credited.current.add(verseId(verses[pv.index]));
      (kind === 'touch' ? touches : reviews).push(verses[pv.index]);
    });
    advance(touches.length + reviews.length, false);
    // Logged after the screen moves on, so a slow write never holds up the next circle.
    const toState = (v: (typeof verses)[number]): VerseState => ({
      book: v.book,
      chapter: v.chapter,
      verse: v.verse,
      text: v.text,
      status: 'memorized',
      translationId: v.translationId,
    });
    const drill = result.mode === 'self' ? 'reveal' : result.mode;
    // A review carries each verse's grade; a missed spot check means it can't move the passage up.
    const gradeFor = (vs: VerseState): GradeInput | undefined => {
      const k = verses.findIndex((v) => v.book === vs.book && v.chapter === vs.chapter && v.verse === vs.verse);
      const pv = result.perVerse.find((x) => x.index === k);
      if (!pv) return undefined;
      return pv.outcomes ? { kind: 'recall', accuracy: wordAccuracy(pv.outcomes) } : { kind: 'self', answer: pv.answer ?? (pv.ok ? 'gotIt' : 'stumbled') };
    };
    if (touches.length > 0) await deps.handleUpdateVerseStatus(touches.map(toState), 'memorized', drill, { perfect: true, quiet: true, via: 'map' });
    if (reviews.length > 0) {
      await deps.handleUpdateVerseStatus(reviews.map(toState), 'memorized', drill, {
        perfect: false,
        quiet: true,
        via: 'map',
        gradeFor,
        ...(result.spotPassed === false ? { canMoveUp: false } : {}),
      });
    }
  };

  const header = (
    <View className="flex-row items-center" style={{ gap: space(8) }}>
      <View className="flex-1" style={{ gap: space(2) }}>
        <AppText variant="title" className="font-sans font-bold text-ink" numberOfLines={1}>
          {formatLabel('walk')}
        </AppText>
        <AppText variant="caption" className="font-sans text-ink-2" numberOfLines={1}>
          {title}
          {phase === 'walk' ? ` · ${step + 1} of ${order.length}` : ''}
        </AppText>
      </View>
      <AppIconButton Icon={X} variant="outline" diameter={40} accessibilityLabel="Close" onPress={onClose} />
    </View>
  );

  return (
    <View className="bg-canvas" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, gap: space(10) }}>
      {header}
      <WalkMap
        result={result}
        groupId={groupId}
        held={held}
        visited={visited}
        target={targetKey}
        start={phase === 'start' ? null : startKey}
        chosen={phase === 'start' ? startKey : null}
        onChoose={phase === 'start' ? setStartKey : undefined}
      />

      {phase === 'start' && (
        <RoundFrame
          footer={<AppButton size="lg" variant="primary" label="Start here" disabled={!startKey || held.size < 2} onPress={begin} />}
        >
          <AppText variant="body" className="font-sans text-ink">
            {held.size < 2
              ? 'Walking needs at least two of these stars in My Verses.'
              : `Tap the star to start from${startKey && starsByKey.get(startKey) ? ` (now ${starsByKey.get(startKey)!.label})` : ''}. The next star along a line appears as an empty circle, and you say what's there.`}
          </AppText>
          <AppText variant="caption" className="font-sans text-ink-2">
            {counts
              ? 'Verses that are due count as reviewed.'
              : 'This is set to practice, so nothing here counts as a review. You can change that in Settings.'}
          </AppText>
        </RoundFrame>
      )}

      {phase === 'walk' && target && (
        <View className="flex-1">
          <WalkRound
            key={targetKey}
            verses={verses}
            creditPreview={(index, passed, perfect, mode) => decide(index, passed, perfect, mode).label}
            onFinish={(r) => void finishRound(r)}
            onSkip={() => advance(0, true)}
            // A spot check only where a review could count.
            spotCheck={!deps.reviewsPaused && verses.some((v) => v.item.status === 'reviewing' && deps.isReviewDue(v.item.nextReviewDueDate))}
          />
        </View>
      )}

      {phase === 'done' && (
        <RoundFrame
          footer={
            <View style={{ gap: space(8) }}>
              {order.length > 0 && <AppButton size="lg" variant="primary" label="Walk again" onPress={() => setPhase('start')} />}
              <AppButton size="lg" variant={order.length > 0 ? 'quiet' : 'primary'} label="Back to the map" onPress={onClose} />
            </View>
          }
        >
          <AppText variant="title" className="font-sans font-bold text-ink">
            {order.length === 0 ? 'Nothing else to walk to' : 'End of the walk'}
          </AppText>
          <AppText variant="body" className="font-sans text-ink-2">
            {order.length === 0
              ? 'No other star in this constellation is in My Verses yet.'
              : `${tally.walked} ${tally.walked === 1 ? 'star' : 'stars'} recited${
                  tally.credited > 0 ? `, ${tally.credited} ${tally.credited === 1 ? 'verse' : 'verses'} counted` : ', none counted'
                }${tally.skipped > 0 ? `, ${tally.skipped} skipped` : ''}.`}
          </AppText>
        </RoundFrame>
      )}
    </View>
  );
}
