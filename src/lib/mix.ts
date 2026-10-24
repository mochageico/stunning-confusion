import type { ChapterSections, QueueItem } from '../types';
import { buildScrambleRounds, buildSwapVerses, DrillVerse } from './drills';
import { FORMATS, FormatId } from './formatNames';
import { reviewPassAccuracy } from './recitation';
import { MIN_SECTION_DRILL_SECTIONS } from './sectionDrills';
import { chapterStretches, normalizeDraft, Section, sectionsFromStarts } from './sections';

// ============================================================================
// MIXED REVIEW -- PURE LOGIC
// ----------------------------------------------------------------------------
// MIXED_REVIEW_PLAN.md, stage 4. Mixed review walks today's due verses chapter
// by chapter and section by section, giving each section a different format.
// Everything it decides lives here: the order, which format each round gets,
// and which verses a round credits. No React, no Firestore -- same pattern as
// guided.ts. The screen (stage 5) renders mixReducer's state, reports results,
// and calls handleReviewCompleted(..., { quiet: true, via: 'mix' }) for each
// entry in `state.newCredits` as soon as a round ends.
//
// The honesty rule (locked): a verse counts as reviewed only when a counting
// format covers it (formatNames FORMATS[id].counts, unless the user switched
// it in Settings: MIX_COUNTS_PREF). A Practice round is
// always followed by a counting round on the same section, and a Practice
// round's results never credit anything, whatever the screen reports.
//
// Open-question defaults used here (the plan's "Open questions"):
//   1. A chapter with 3+ sections opens with one Practice round (Put in order
//      or Which section), followed straight away by a counting round.
//   2. Chapters follow Today's order: daily, then weekly, then monthly.
//   3. A counting round below 90% is a miss, exactly like Recall. (Pick up the
//      thread on its own never penalizes a miss; Keep going in the mix does,
//      until the user says otherwise.)
//
// Every random choice takes `rng` so the checks are repeatable. Tested by
// mix.check.ts (`npm run check:mix`).
// ============================================================================

export type Rng = () => number;

/** Every format, in the order Settings lists them: counting ones first. */
export const MIX_FORMAT_ORDER: FormatId[] = [
  'recite',
  'keepGoing',
  'firstWords',
  'findWrongWord',
  'scramble',
  'putInOrder',
  'whichSection',
  'teachIt',
];

/** All of them, until the user turns some off in Settings. */
export const DEFAULT_MIX_FORMATS: FormatId[] = [...MIX_FORMAT_ORDER];

/** The practicePrefs key for the formats in the mix. */
export const MIX_FORMATS_PREF = 'mixFormats';

/** What practicePrefs holds, cleaned up: known ids only, in Settings order. Anything unreadable gives the default. */
export const readMixFormats = (raw: unknown): FormatId[] => {
  if (!Array.isArray(raw)) return DEFAULT_MIX_FORMATS;
  return MIX_FORMAT_ORDER.filter((id) => raw.includes(id));
};

/** Recite needs nothing, so it is what the mix falls back to (even when switched off). */
export const FALLBACK_FORMAT: FormatId = 'recite';

/** Formats that only make sense for a whole chapter, so only ever open one. */
const OPENER_FORMATS: FormatId[] = ['putInOrder', 'whichSection'];

/** Which formats count, by format: the user can switch any of them in Settings. */
export type MixCounts = Record<FormatId, boolean>;

/** The practicePrefs key for the user's Counts / Practice choice per format. */
export const MIX_COUNTS_PREF = 'mixCounts';

/**
 * What practicePrefs holds, cleaned up: each format's saved choice, or its
 * usual tag (formatNames FORMATS) when there's none. Recite always counts:
 * it's what every Practice round falls back on, so the mix can't end up
 * with nothing that reviews a verse.
 */
export const readMixCounts = (raw: unknown): MixCounts => {
  const saved = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = {} as MixCounts;
  MIX_FORMAT_ORDER.forEach((id) => {
    out[id] =
      id === FALLBACK_FORMAT ||
      (FORMATS[id].canCount !== false && (typeof saved[id] === 'boolean' ? (saved[id] as boolean) : FORMATS[id].counts));
  });
  return out;
};

export const countsAsReview = (id: FormatId, counts?: Partial<MixCounts>): boolean =>
  id === FALLBACK_FORMAT || (FORMATS[id].canCount !== false && (counts?.[id] ?? FORMATS[id].counts));

// ============================================================================
// 1. UNITS -- chapters, then sections (or stretches)
// ============================================================================

export interface MixChapter {
  /** translation|book|chapter: two translations of a chapter are two chapters here. */
  key: string;
  book: string;
  chapter: number;
  translationId: string;
  /** The chapter's sections that hold a due verse (0 when it has none of its own). */
  sectionCount: number;
  /** Indexes into MixPlan.units, in reading order. */
  unitIndexes: number[];
}

export interface MixUnit {
  index: number;
  chapterKey: string;
  kind: 'section' | 'stretch';
  /** Sections only: its place in the whole chapter, for the bracket color. */
  sectionIndex?: number;
  label?: string;
  /** First and last verse numbers of the due verses in it. */
  start: number;
  end: number;
  /** The due verses it covers, in verse order. */
  verseIds: string[];
  /**
   * The started verse just before it, when there is one and the unit's verses
   * run unbroken: what Keep going cues from, so every verse in the unit is
   * said whole.
   */
  contextVerseId?: string;
}

export interface MixRound {
  index: number;
  format: FormatId;
  counts: boolean;
  /** opener: a chapter's Practice opener. main: the section's draw. follow: the counting round after a Practice one. */
  role: 'opener' | 'main' | 'follow';
  /** The unit it belongs to (an opener: the chapter's first unit). */
  unitIndex: number;
  chapterKey: string;
  /** The verses it is about. Only these can ever be credited by it. */
  verseIds: string[];
}

export interface MixPlan {
  chapters: MixChapter[];
  units: MixUnit[];
  rounds: MixRound[];
}

export interface MixInput {
  /** Today's due reviewing items. The caller filters (status reviewing, due, reviews not paused). */
  due: QueueItem[];
  /** The whole memory queue, in its own order: Keep going's context verses come from here. */
  pool: QueueItem[];
  /** sectionsForChapter from useChapterSections. */
  sectionsFor: (book: string, chapter: number) => ChapterSections | null | undefined;
  /** The formats switched on in Settings. */
  enabled: FormatId[];
  /** Which formats count (readMixCounts). Left out: each format's usual tag. */
  counts?: Partial<MixCounts>;
}

const toVerse = (item: QueueItem): DrillVerse & { id: string } => ({
  id: item.verseId,
  book: item.book,
  chapter: item.chapter,
  verse: item.verseNumber,
  text: item.text,
  translationId: item.translationId,
});

const chapterKeyOf = (item: Pick<QueueItem, 'translationId' | 'book' | 'chapter'>): string =>
  `${item.translationId || ''}|${item.book}|${item.chapter}`;

const PHASE_ORDER: QueueItem['retentionPhase'][] = ['daily', 'weekly', 'monthly'];

/**
 * Due items in Today's order: daily, then weekly, then monthly, each in queue
 * order (Home lists them that way and "Review all due" runs them that way).
 * Anything in another phase goes last rather than being dropped.
 */
export const todayOrder = (due: QueueItem[]): QueueItem[] => {
  const rank = (i: QueueItem) => {
    const r = PHASE_ORDER.indexOf(i.retentionPhase);
    return r < 0 ? PHASE_ORDER.length : r;
  };
  return due.map((item, pos) => ({ item, pos })).sort((a, b) => rank(a.item) - rank(b.item) || a.pos - b.pos).map((x) => x.item);
};

/** Unbroken runs of verse numbers. */
const runsOf = <V extends { verse: number }>(sorted: V[]): V[][] => {
  const runs: V[][] = [];
  sorted.forEach((v, i) => {
    if (i > 0 && v.verse === sorted[i - 1].verse + 1) runs[runs.length - 1].push(v);
    else runs.push([v]);
  });
  return runs;
};

/**
 * Stand-in sections for a chapter with none: each unbroken run of due verses
 * cut into stretches of 4 (chapterStretches, so neighbors share a verse). A
 * lone verse is a stretch of its own -- buildThreadPassages drops runs of one,
 * and a due verse must never fall out of the session.
 */
const stretchesFor = <V extends DrillVerse>(sorted: V[]): V[][] =>
  runsOf(sorted).flatMap((run) => (run.length === 1 ? [run] : chapterStretches(run)));

/**
 * The chapter's sections that hold a due verse, each with those verses. []
 * when the chapter has no sections of its own (one start, or no doc). Unlike
 * sectionDrills' drillSections, a chapter whose due verses all sit in one
 * section still counts as sectioned: its one section is the unit, not
 * stretches cut across it.
 */
const dueSections = <V extends DrillVerse>(sorted: V[], doc: ChapterSections | null | undefined): (Section & { verses: V[] })[] => {
  if (!doc || sorted.length === 0) return [];
  const lastVerse = Math.max(sorted[sorted.length - 1].verse, ...doc.starts.filter((n) => Number.isInteger(n)));
  const draft = normalizeDraft(doc, 1, lastVerse);
  if (draft.starts.length < 2) return [];
  return sectionsFromStarts(draft, lastVerse)
    .map((s) => ({ ...s, verses: sorted.filter((v) => v.verse >= s.start && v.verse <= s.end) }))
    .filter((s) => s.verses.length > 0);
};

/** Chapters in Today's order, each with its units. No rounds yet. */
export const buildUnits = (input: Pick<MixInput, 'due' | 'pool' | 'sectionsFor'>): { chapters: MixChapter[]; units: MixUnit[] } => {
  // A verse due twice (a data oddity) is reviewed once.
  const seen = new Set<string>();
  const ordered = todayOrder(input.due).filter((i) => (seen.has(i.verseId) ? false : (seen.add(i.verseId), true)));

  const byChapter = new Map<string, QueueItem[]>();
  ordered.forEach((item) => {
    const k = chapterKeyOf(item);
    const g = byChapter.get(k);
    if (g) g.push(item);
    else byChapter.set(k, [item]);
  });

  const started = new Map<string, QueueItem>();
  input.pool.forEach((i) => {
    if (i.status !== 'queued') started.set(`${chapterKeyOf(i)}|${i.verseNumber}`, i);
  });
  const contextFor = (key: string, verses: { verse: number }[]): string | undefined => {
    const unbroken = verses.every((v, i) => i === 0 || v.verse === verses[i - 1].verse + 1);
    if (!unbroken) return undefined;
    return started.get(`${key}|${verses[0].verse - 1}`)?.verseId;
  };

  const chapters: MixChapter[] = [];
  const units: MixUnit[] = [];
  // Map keeps insertion order: the chapter of the first item in Today's order comes first.
  byChapter.forEach((items, key) => {
    const first = items[0];
    const verses = items.map(toVerse).sort((a, b) => a.verse - b.verse);
    const sections = dueSections(verses, input.sectionsFor(first.book, first.chapter));
    const unitIndexes: number[] = [];
    const push = (u: Omit<MixUnit, 'index' | 'chapterKey' | 'contextVerseId'>, vs: { verse: number }[]) => {
      const unit: MixUnit = { ...u, index: units.length, chapterKey: key };
      const context = contextFor(key, vs);
      if (context) unit.contextVerseId = context;
      units.push(unit);
      unitIndexes.push(unit.index);
    };
    if (sections.length > 0) {
      sections.forEach((s) =>
        push(
          {
            kind: 'section',
            sectionIndex: s.index,
            ...(s.label ? { label: s.label } : {}),
            start: s.verses[0].verse,
            end: s.verses[s.verses.length - 1].verse,
            verseIds: s.verses.map((v) => v.id),
          },
          s.verses
        )
      );
    } else {
      stretchesFor(verses).forEach((st) =>
        push({ kind: 'stretch', start: st[0].verse, end: st[st.length - 1].verse, verseIds: st.map((v) => v.id) }, st)
      );
    }
    chapters.push({
      key,
      book: first.book,
      chapter: first.chapter,
      translationId: first.translationId,
      sectionCount: sections.length,
      unitIndexes,
    });
  });
  return { chapters, units };
};

// ============================================================================
// 2. FORMAT DRAWS
// ============================================================================

/**
 * Whether a format can run on a unit. Recite, First words and Teach-It work
 * on anything. Keep going needs the started verse just before the unit to cue
 * from. Find the wrong word needs a wrong word for every verse (one without
 * would never be tested). Scramble needs a verse that splits into tiles.
 * Which section needs a chapter of 3+ sections. Put in order is a whole
 * chapter's round, so it only ever opens one.
 */
export const formatFits = (format: FormatId, unit: MixUnit, chapter: MixChapter, verses: DrillVerse[]): boolean => {
  switch (format) {
    case 'recite':
    case 'firstWords':
    case 'teachIt':
      return true;
    case 'keepGoing':
      return !!unit.contextVerseId;
    case 'findWrongWord':
      return verses.length > 0 && buildSwapVerses(verses).every((sv) => sv.tokens.some((t) => t.isDecoy));
    case 'scramble':
      return buildScrambleRounds(verses).length > 0;
    case 'whichSection':
      return unit.kind === 'section' && chapter.sectionCount >= MIN_SECTION_DRILL_SECTIONS;
    case 'putInOrder':
      return false;
  }
};

const pick = <T>(items: T[], rng: Rng): T => items[Math.min(items.length - 1, Math.floor(rng() * items.length))];

/**
 * One format from `candidates`, never `previous` (no format twice in a row).
 * Recite when nothing is left -- which can mean Recite twice in a row, when
 * Recite is all that fits.
 */
export const drawFormat = (candidates: FormatId[], previous: FormatId | undefined, rng: Rng): FormatId => {
  const pool = candidates.filter((f) => f !== previous);
  return pool.length > 0 ? pick(pool, rng) : FALLBACK_FORMAT;
};

/** The whole session's rounds, decided up front so the screen can show "section 3 of 9". */
export const buildMixPlan = (input: MixInput, rng: Rng): MixPlan => {
  const { chapters, units } = buildUnits(input);
  const enabled = MIX_FORMAT_ORDER.filter((f) => input.enabled.includes(f));
  const byId = new Map<string, QueueItem>();
  input.due.forEach((i) => byId.set(i.verseId, i));
  const versesOf = (ids: string[]) => ids.map((id) => byId.get(id)).filter((i): i is QueueItem => !!i).map(toVerse);

  const counts = (f: FormatId) => countsAsReview(f, input.counts);
  const rounds: MixRound[] = [];
  let previous: FormatId | undefined;
  const add = (r: Omit<MixRound, 'index' | 'counts'>) => {
    rounds.push({ ...r, index: rounds.length, counts: counts(r.format) });
    previous = r.format;
  };

  chapters.forEach((chapter) => {
    let countingOnly = false;
    const openers = enabled.filter((f) => OPENER_FORMATS.includes(f) && f !== previous);
    if (chapter.sectionCount >= MIN_SECTION_DRILL_SECTIONS && openers.length > 0 && chapter.unitIndexes.length > 0) {
      add({
        format: pick(openers, rng),
        role: 'opener',
        unitIndex: chapter.unitIndexes[0],
        chapterKey: chapter.key,
        verseIds: chapter.unitIndexes.flatMap((u) => units[u].verseIds),
      });
      // A Practice opener: what follows it has to count.
      countingOnly = !rounds[rounds.length - 1].counts;
    }

    chapter.unitIndexes.forEach((u) => {
      const unit = units[u];
      const verses = versesOf(unit.verseIds);
      const fits = enabled.filter((f) => formatFits(f, unit, chapter, verses));
      const counting = fits.filter(counts);
      const main = drawFormat(countingOnly ? counting : fits, previous, rng);
      countingOnly = false;
      add({ format: main, role: 'main', unitIndex: u, chapterKey: chapter.key, verseIds: unit.verseIds });
      if (!counts(main)) {
        add({ format: drawFormat(counting, previous, rng), role: 'follow', unitIndex: u, chapterKey: chapter.key, verseIds: unit.verseIds });
      }
    });
  });

  return { chapters, units, rounds };
};

// ============================================================================
// 3. CREDIT
// ============================================================================

export type MixAnswerMode = 'speak' | 'type' | 'self';

/** What a round reports for one verse. */
export interface MixVerseResult {
  mode: MixAnswerMode;
  /** Graded share of words right, 0..1. Self-checked results leave it out. */
  accuracy?: number;
  /** Self-checked: the user's own Got it / Not really. Ignored when accuracy is given. */
  gotIt?: boolean;
  /** No missed words (summarizeOutcomes().isPerfect). */
  perfect?: boolean;
}

export interface MixCredit {
  verseId: string;
  /** pass/miss as handleReviewCompleted's `success`. */
  outcome: 'pass' | 'miss';
  mode: MixAnswerMode;
  /** opts.perfect. Never true for a self-check or a miss. */
  perfect: boolean;
  format: FormatId;
  roundIndex: number;
  unitIndex: number;
}

/**
 * What one verse's result is worth (open question 3's default): graded at
 * 90% or more is a pass, under it a miss, exactly like Recall. A self-check
 * passes on Got it and misses on Not really.
 */
export const verseOutcome = (r: MixVerseResult): 'pass' | 'miss' => {
  if (typeof r.accuracy === 'number') return r.accuracy >= reviewPassAccuracy() ? 'pass' : 'miss';
  return r.gotIt ? 'pass' : 'miss';
};

/**
 * The credits one round earns. Nothing from a Practice round. Nothing for a
 * verse the round isn't about (Keep going's context verse, a stray id). A
 * verse already credited this session keeps its first credit: neighboring
 * stretches share a verse, and handleReviewCompleted should hear about each
 * verse once.
 */
export const roundCredits = (
  round: MixRound,
  perVerse: Record<string, MixVerseResult> | undefined,
  already: ReadonlySet<string>
): MixCredit[] => {
  if (!round.counts || !perVerse) return [];
  const out: MixCredit[] = [];
  round.verseIds.forEach((id) => {
    const r = perVerse[id];
    if (!r || already.has(id)) return;
    const outcome = verseOutcome(r);
    out.push({
      verseId: id,
      outcome,
      mode: r.mode,
      perfect: outcome === 'pass' && r.mode !== 'self' && r.perfect === true,
      format: round.format,
      roundIndex: round.index,
      unitIndex: round.unitIndex,
    });
  });
  return out;
};

// ============================================================================
// 4. THE SESSION
// ============================================================================

export interface MixLogEntry {
  roundIndex: number;
  format: FormatId;
  skipped: boolean;
}

export interface MixState {
  plan: MixPlan;
  status: 'ready' | 'running' | 'finished' | 'stopped';
  /** The round on screen (rounds.length once finished). */
  pos: number;
  /** Every credit so far, in the order earned. Stopping keeps them all. */
  credits: MixCredit[];
  /** The credits the last event earned: the screen sends exactly these to handleReviewCompleted. */
  newCredits: MixCredit[];
  log: MixLogEntry[];
}

export type MixEvent =
  | { type: 'start' }
  /** A round ended. Counting rounds report per verse; Practice rounds may report nothing (and anything they report is ignored). */
  | { type: 'result'; perVerse?: Record<string, MixVerseResult> }
  /** Skip this round: no credit and no penalty. Skipping a Practice round still leaves its counting round. */
  | { type: 'skip' }
  /** Stop for today. What already counted stays counted. */
  | { type: 'stop' };

export const startMix = (plan: MixPlan): MixState => ({
  plan,
  status: 'ready',
  pos: 0,
  credits: [],
  newCredits: [],
  log: [],
});

export const currentRound = (s: MixState): MixRound | undefined =>
  s.status === 'running' ? s.plan.rounds[s.pos] : undefined;

const advance = (s: MixState, entry: MixLogEntry, earned: MixCredit[]): MixState => {
  const pos = s.pos + 1;
  return {
    ...s,
    pos,
    status: pos >= s.plan.rounds.length ? 'finished' : 'running',
    credits: earned.length > 0 ? [...s.credits, ...earned] : s.credits,
    newCredits: earned,
    log: [...s.log, entry],
  };
};

/** The whole session as a state machine. The screen calls only this. */
export const mixReducer = (s: MixState, event: MixEvent): MixState => {
  if (s.status === 'finished' || s.status === 'stopped') return s.newCredits.length > 0 ? { ...s, newCredits: [] } : s;

  if (event.type === 'stop') return { ...s, status: 'stopped', newCredits: [] };

  if (s.status === 'ready') {
    if (event.type !== 'start') return s;
    return s.plan.rounds.length === 0 ? { ...s, status: 'finished' } : { ...s, status: 'running' };
  }

  const round = s.plan.rounds[s.pos];
  if (!round) return { ...s, status: 'finished', newCredits: [] };

  if (event.type === 'skip') return advance(s, { roundIndex: round.index, format: round.format, skipped: true }, []);
  if (event.type === 'result') {
    const already = new Set(s.credits.map((c) => c.verseId));
    return advance(s, { roundIndex: round.index, format: round.format, skipped: false }, roundCredits(round, event.perVerse, already));
  }
  return s;
};

// ============================================================================
// 5. RECAP
// ============================================================================

export interface MixSummary {
  /** Due verses in the session. */
  verses: number;
  passed: string[];
  missed: string[];
  /** Due verses no counting round covered (skipped or not reached). Not reviewed today. */
  notCovered: string[];
  /** Units with at least one miss: the recap's "Where you slipped". */
  slippedUnits: number[];
  /** Formats that ran (not skipped), in first-use order. */
  formatsUsed: FormatId[];
}

export const mixSummary = (s: MixState): MixSummary => {
  const all = Array.from(new Set(s.plan.units.flatMap((u) => u.verseIds)));
  const credited = new Map(s.credits.map((c) => [c.verseId, c]));
  const missed = s.credits.filter((c) => c.outcome === 'miss');
  const formatsUsed: FormatId[] = [];
  s.log.forEach((e) => {
    if (!e.skipped && !formatsUsed.includes(e.format)) formatsUsed.push(e.format);
  });
  return {
    verses: all.length,
    passed: s.credits.filter((c) => c.outcome === 'pass').map((c) => c.verseId),
    missed: missed.map((c) => c.verseId),
    notCovered: all.filter((id) => !credited.has(id)),
    slippedUnits: Array.from(new Set(missed.map((c) => c.unitIndex))),
    formatsUsed,
  };
};
