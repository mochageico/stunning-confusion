import { useEffect, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { RotateCcw } from 'lucide-react-native';

import type { VerseState } from '../../types';
import { AppButton, AppText, useScaledSpace } from '../design';
import SpotGapDrill from '../drills/SpotGapDrill';
import OpeningsDrill from '../drills/OpeningsDrill';
import { SelfCheckFlow, type SelfCheckResult } from './SelfCheck';
import type { GapScore } from '../../lib/spotGap';
import type { OpeningResult } from '../../lib/openings';
import { loadPracticePrefs } from '../../lib/practicePrefs';
import { scriptOfVerse } from '../../lib/textScript';

// ============================================================================
// SPOT THE GAP AND OPENINGS IN NORMAL REVIEW
// ----------------------------------------------------------------------------
// The same two rounds Mixed review runs, on the practice screen's mode picker.
// Both count as a review for the verses that are due (graded like a typed
// recall, quietly, as First words does); a verse that isn't due, or is still
// Learning, is practice only. Each round credits once, and "Go again" starts a
// fresh one that credits nothing new for verses already counted this sitting.
// ============================================================================

/** What a round says about one verse. */
export interface FormatCredit {
  verse: VerseState;
  accuracy: number;
  perfect: boolean;
}

interface Props {
  verses: VerseState[];
  /** On a review schedule and due: only these are logged. */
  isDue: (v: VerseState) => boolean;
  /** Logs the due verses' results. */
  onCredit: (rows: FormatCredit[]) => void;
}

const dueRows = (rows: FormatCredit[], isDue: Props['isDue']) => rows.filter((r) => isDue(r.verse));

/** The two Settings switches that make Spot the gap harder. */
const useGapPrefs = () => {
  const [prefs, setPrefs] = useState<{ hideNumbers: boolean; shuffle: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    loadPracticePrefs().then((saved) => {
      if (live) setPrefs({ hideNumbers: saved.spotGapShowNumbers === false, shuffle: saved.spotGapInOrder === false });
    });
    return () => {
      live = false;
    };
  }, []);
  return prefs;
};

/** A line under a finished round, and the way to another one. */
function Finished({ line, onAgain }: { line: string; onAgain: () => void }) {
  const space = useScaledSpace();
  return (
    <View className="shrink-0" style={{ gap: space(8) }}>
      <AppText variant="caption" className="font-sans text-ink-3 text-center">
        {line}
      </AppText>
      <AppButton size="lg" variant="primary" Icon={RotateCcw} label="Go again" onPress={onAgain} />
    </View>
  );
}

const creditedNote = (rows: FormatCredit[], isDue: Props['isDue']) => {
  const due = dueRows(rows, isDue).length;
  return due === 0 ? 'This one is practice: nothing was due, so nothing was logged.' : `Logged as a review for ${due} due ${due === 1 ? 'verse' : 'verses'}.`;
};

// ----------------------------------------------------------------------------
// Spot the gap
// ----------------------------------------------------------------------------

export function GapPractice({ verses, isDue, onCredit }: Props) {
  const prefs = useGapPrefs();
  const [round, setRound] = useState(0);
  const [score, setScore] = useState<GapScore | null>(null);
  const credited = useRef(false);

  // A new passage (a chained review swaps `verses` in place) is a new round.
  const passageKey = verses.map((v) => `${v.book}${v.chapter}:${v.verse}`).join();
  useEffect(() => {
    setRound((n) => n + 1);
    setScore(null);
    credited.current = false;
  }, [passageKey]);

  const rows = (s: GapScore): FormatCredit[] =>
    s.perVerse.flatMap((row) => (verses[row.verseIndex] ? [{ verse: verses[row.verseIndex], accuracy: row.accuracy, perfect: row.perfect }] : []));

  const scored = (s: GapScore) => {
    setScore(s);
    if (credited.current) return;
    credited.current = true;
    const due = dueRows(rows(s), isDue);
    if (due.length > 0) onCredit(due);
  };

  if (!prefs) return null;
  return (
    <View className="flex-1" style={{ gap: 10 }}>
      <View className="flex-1">
        <SpotGapDrill
          key={`${passageKey}:${round}`}
          verses={verses}
          hideNumbers={prefs.hideNumbers}
          shuffle={prefs.shuffle}
          resultNote="a due verse is logged as a review."
          onScored={scored}
        />
      </View>
      {score && (
        <Finished
          line={creditedNote(rows(score), isDue)}
          onAgain={() => {
            setRound((n) => n + 1);
            setScore(null);
            credited.current = false;
          }}
        />
      )}
    </View>
  );
}

// ----------------------------------------------------------------------------
// Openings
// ----------------------------------------------------------------------------

export function OpeningsPractice({ verses, isDue, onCredit }: Props) {
  const space = useScaledSpace();
  const [round, setRound] = useState(0);
  const [openings, setOpenings] = useState<OpeningResult[] | null>(null);
  const [stage, setStage] = useState<'reveal' | 'pickSlip' | 'spot'>('reveal');
  const [done, setDone] = useState<FormatCredit[] | null>(null);
  const credited = useRef(false);

  const passageKey = verses.map((v) => `${v.book}${v.chapter}:${v.verse}`).join();
  const reset = () => {
    setRound((n) => n + 1);
    setOpenings(null);
    setStage('reveal');
    setDone(null);
    credited.current = false;
  };
  useEffect(reset, [passageKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // The opening typed grades each verse; the rest, checked against the text, can only lower it.
  const finish = (r: SelfCheckResult) => {
    if (!openings) return;
    const rows = verses.map((verse, i): FormatCredit => {
      const cap = r.answers[i] === 'blanked' ? 0.3 : r.answers[i] === 'stumbled' ? 0.8 : 1;
      const accuracy = Math.min(openings[i]?.accuracy ?? 0, cap);
      return { verse, accuracy, perfect: accuracy === 1 };
    });
    setDone(rows);
    if (credited.current) return;
    credited.current = true;
    const due = dueRows(rows, isDue);
    if (due.length > 0) onCredit(due);
  };

  if (done) {
    const clean = done.filter((r) => r.perfect).length;
    return (
      <View className="flex-1 justify-center" style={{ gap: space(12) }}>
        <AppText variant="title" className="font-sans font-bold text-ink text-center">
          {clean} of {done.length} verses clean
        </AppText>
        <Finished line={creditedNote(done, isDue)} onAgain={reset} />
      </View>
    );
  }

  if (!openings) return <OpeningsDrill key={`${passageKey}:${round}`} verses={verses} onComplete={setOpenings} />;

  if (stage === 'pickSlip' || stage === 'spot') {
    return (
      <SelfCheckFlow
        verses={verses}
        allGotIt={stage === 'spot'}
        // The openings were typed, so the rest needs no second recital.
        spotCheck={false}
        onBack={() => setStage('reveal')}
        onDone={finish}
      />
    );
  }

  return (
    <View className="flex-1 justify-between">
      <ScrollView className="flex-1" contentContainerStyle={{ gap: space(10), paddingBottom: space(8) }}>
        <AppText variant="label" className="font-sans text-ink-2">
          Now say the rest of each verse, then check yourself against the text.
        </AppText>
        {verses.map((v) => (
          <AppText key={`${v.chapter}:${v.verse}`} variant="body" script={scriptOfVerse(v)} className="font-serif text-ink">
            <AppText variant="caption" className="font-sans font-bold text-ink-3">
              {v.verse}{' '}
            </AppText>
            {v.text}
          </AppText>
        ))}
      </ScrollView>
      <View className="shrink-0 flex-row" style={{ gap: space(8), paddingTop: space(8) }}>
        <View className="flex-1">
          <AppButton size="lg" variant="secondary" label="Missed some" onPress={() => setStage('pickSlip')} />
        </View>
        <View className="flex-1">
          <AppButton size="lg" variant="primary" label="Got it" onPress={() => setStage('spot')} />
        </View>
      </View>
    </View>
  );
}
