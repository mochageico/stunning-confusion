import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Minus, Plus, Search, X } from 'lucide-react-native';

import type { QueueItem, StarRef, VerseLink } from '../../types';
import { AppButton, AppIconButton, AppText, AppTextInput, useFontScale, useScaledSpace } from '../design';
import { Dialog } from '../blocks';
import { useThemeColors } from '../theme';
import { refsOverlap, starKey } from '../../lib/constellations';
import { starLabel } from '../../lib/mapLayout';
import { Run, clampToRun, heldRuns, runForRef, runLabel, runRef } from './linkRuns';

// ============================================================================
// "Connect to another verse" -- pick one of your verses, trim both ends, save.
// Two steps in one sheet. A link joins two ranges; each range starts as the
// unbroken run of verses you hold around the tapped one, and the steppers only
// go as far as that run does.
// ============================================================================

const RECENT_COUNT = 6;
const MAX_RESULTS = 30;

/** "From verse 5 [−] [+]": one edge of a range. */
export function Stepper({ label, value, canDown, canUp, onDown, onUp }: { label: string; value: number; canDown: boolean; canUp: boolean; onDown: () => void; onUp: () => void }) {
  const space = useScaledSpace();
  return (
    <View className="flex-row items-center" style={{ gap: space(10) }}>
      <AppText variant="label" className="font-sans text-ink-2 flex-1">
        {label}
      </AppText>
      <AppIconButton Icon={Minus} variant="outline" diameter={44} disabled={!canDown} onPress={onDown} accessibilityLabel={`${label}: one earlier`} />
      <AppText variant="title" className="font-sans font-bold text-ink text-center" style={{ minWidth: space(40) }}>
        {value}
      </AppText>
      <AppIconButton Icon={Plus} variant="outline" diameter={44} disabled={!canUp} onPress={onUp} accessibilityLabel={`${label}: one later`} />
    </View>
  );
}

/** One end of the link, with its two steppers. */
export function EndTrim({ title, run, range, onChange }: { title: string; run: Run; range: StarRef; onChange: (next: StarRef) => void }) {
  const space = useScaledSpace();
  return (
    <View className="bg-surface-2 rounded-card" style={{ padding: space(14), gap: space(10) }}>
      <View style={{ gap: space(2) }}>
        <AppText variant="caption" className="font-sans text-ink-2">
          {title}
        </AppText>
        <AppText variant="title" className="font-sans font-bold text-ink">
          {starLabel(range)}
        </AppText>
      </View>
      {run.end > run.start ? (
        <>
          <Stepper
            label="From verse"
            value={range.start}
            canDown={range.start > run.start}
            canUp={range.start < range.end}
            onDown={() => onChange({ ...range, start: range.start - 1 })}
            onUp={() => onChange({ ...range, start: range.start + 1 })}
          />
          <Stepper
            label="To verse"
            value={range.end}
            canDown={range.end > range.start}
            canUp={range.end < run.end}
            onDown={() => onChange({ ...range, end: range.end - 1 })}
            onUp={() => onChange({ ...range, end: range.end + 1 })}
          />
        </>
      ) : null}
    </View>
  );
}

export default function ConnectSheet({
  from,
  queue,
  links,
  onClose,
  onSave,
}: {
  /** The passage being connected; null keeps the sheet closed. */
  from: StarRef | null;
  queue: QueueItem[];
  links: VerseLink[];
  onClose: () => void;
  onSave: (a: StarRef, b: StarRef) => void;
}) {
  const space = useScaledSpace();
  const scale = useFontScale();
  const palette = useThemeColors();
  const [query, setQuery] = useState('');
  const [other, setOther] = useState<Run | null>(null);
  const [a, setA] = useState<StarRef | null>(null);
  const [b, setB] = useState<StarRef | null>(null);

  const runs = useMemo(() => heldRuns(queue), [queue]);
  const fromRun = useMemo(() => (from ? runForRef(runs, from) : null), [runs, from]);

  // A fresh start each time it opens.
  useEffect(() => {
    setQuery('');
    setOther(null);
    setA(null);
    setB(null);
  }, [from]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return runs.slice(0, RECENT_COUNT);
    return runs.filter((r) => `${runLabel(r)} ${r.text}`.toLowerCase().includes(q)).slice(0, MAX_RESULTS);
  }, [runs, query]);

  const pick = (run: Run) => {
    if (!from || !fromRun) return;
    setOther(run);
    setA(clampToRun(from, fromRun));
    setB(runRef(run));
  };

  const same = !!a && !!b && refsOverlap(a, b);
  const taken = !!a && !!b && links.some((l) => !l.curated && [starKey(l.a), starKey(l.b)].sort().join() === [starKey(a), starKey(b)].sort().join());
  const ready = !!a && !!b && !same && !taken;
  const iconSize = Math.round(18 * scale);

  return (
    <Dialog
      visible={!!from}
      onClose={onClose}
      placement="sheet"
      title={other ? 'Trim the passages' : 'Connect to another verse'}
      actions={
        other ? (
          <>
            <AppButton variant="quiet" label="Back" onPress={() => setOther(null)} />
            <AppButton variant="primary" label="Connect" disabled={!ready} onPress={() => a && b && onSave(a, b)} />
          </>
        ) : undefined
      }
    >
      {!from ? null : !fromRun ? (
        <AppText variant="body" className="font-sans text-ink-2">
          Start this verse first, and then you can connect it to another.
        </AppText>
      ) : other && a && b ? (
        <View style={{ gap: space(12) }}>
          <AppText variant="label" className="font-sans text-ink-2">
            Each passage can be shortened. They can only cover verses you already have.
          </AppText>
          <EndTrim title="This passage" run={fromRun} range={a} onChange={setA} />
          <EndTrim title="Joined to" run={other} range={b} onChange={setB} />
          {same ? (
            <AppText variant="label" className="font-sans text-danger">
              These overlap. Shorten one so they share no verses.
            </AppText>
          ) : taken ? (
            <AppText variant="label" className="font-sans text-ink-2">
              You've already joined these two.
            </AppText>
          ) : null}
        </View>
      ) : (
        <View style={{ gap: space(12) }}>
          <AppText variant="label" className="font-sans text-ink-2">
            Joining {starLabel(clampToRun(from, fromRun))} to:
          </AppText>
          <View className="flex-row items-center bg-surface border border-line rounded-btn" style={{ paddingHorizontal: space(12), gap: space(8) }}>
            <Search size={iconSize} color={palette.ink3} />
            <AppTextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search your verses"
              accessibilityLabel="Search your verses"
              variant="body"
              className="flex-1 text-ink font-sans"
              style={{ minWidth: 0, paddingVertical: space(10) }}
            />
            {query ? (
              <Pressable onPress={() => setQuery('')} hitSlop={10} accessibilityRole="button" accessibilityLabel="Clear search">
                <X size={iconSize} color={palette.ink3} />
              </Pressable>
            ) : null}
          </View>
          {!query ? (
            <AppText variant="caption" className="font-sans font-semibold text-ink-2">
              Recent
            </AppText>
          ) : null}
          {shown.length === 0 ? (
            <AppText variant="label" className="font-sans text-ink-2">
              No verse of yours matches that.
            </AppText>
          ) : (
            shown.map((r) => (
              <Pressable
                key={`${r.book}|${r.chapter}|${r.start}`}
                onPress={() => pick(r)}
                accessibilityRole="button"
                className="border-b border-hairline active:opacity-60"
                style={{ minHeight: 48, paddingVertical: space(8), gap: space(2) }}
              >
                <AppText variant="label" className="font-sans font-bold text-ink">
                  {runLabel(r)}
                </AppText>
                <AppText variant="caption" className="font-serif text-ink-2" numberOfLines={1}>
                  {r.text}
                </AppText>
              </Pressable>
            ))
          )}
        </View>
      )}
    </Dialog>
  );
}
