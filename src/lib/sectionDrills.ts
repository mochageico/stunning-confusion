import type { ChapterSections, TextScript } from '../types';
import type { DrillVerse } from './drills';
import { chapterStretches, normalizeDraft, Section, sectionRangeText, sectionsFromStarts } from './sections';
import { splitWords } from './textScript';

// ============================================================================
// SECTION DRILLS -- Put in order, Which section, Teach-It
// ----------------------------------------------------------------------------
// MIXED_REVIEW_PLAN.md, stage 3. All three are Practice (formatNames.ts): they
// work with a chapter's sections rather than saying verses from memory, so
// none of them ever credits a review. This file holds what they decide; the
// components in components/drills/ only draw it.
//
// Sections are the user's own (lib/sections.ts). Put in order and Which section
// need MIN_SECTION_DRILL_SECTIONS of them; Teach-It works on any selection and
// falls back to short stretches when the chapter has none.
//
// Tested by sectionDrills.check.ts.
// ============================================================================

export type Rng = () => number;

/** Fewer sections than this and there is nothing to put in order or tell apart. */
export const MIN_SECTION_DRILL_SECTIONS = 3;

/** A section as the drills see it: its range plus the verses of the selection inside it. */
export interface DrillSection<V extends DrillVerse = DrillVerse> extends Section {
  verses: V[];
}

const oneChapter = (verses: DrillVerse[]): boolean =>
  verses.length > 0 && verses.every((v) => v.book === verses[0].book && v.chapter === verses[0].chapter);

/**
 * The chapter's sections as far as the selection reaches: only a selection
 * from a single chapter has sections, and a section none of the selected
 * verses falls in is left out. `index` stays the section's place in the whole
 * chapter, so its bracket color matches the chapter page. The last section
 * ends at the last selected verse (the doc doesn't record the chapter's end).
 */
export function drillSections<V extends DrillVerse>(verses: V[], doc: ChapterSections | null | undefined): DrillSection<V>[] {
  if (!doc || !oneChapter(verses)) return [];
  const lastVerse = verses.reduce((m, v) => Math.max(m, v.verse), 1);
  const draft = normalizeDraft(doc, 1, lastVerse);
  if (draft.starts.length < 2) return [];
  return sectionsFromStarts(draft, lastVerse)
    .map((s) => ({ ...s, verses: verses.filter((v) => v.verse >= s.start && v.verse <= s.end) }))
    .filter((s) => s.verses.length > 0);
}

/** Whether Put in order and Which section have enough sections to run. */
export const hasEnoughSections = (sections: unknown[]): boolean => sections.length >= MIN_SECTION_DRILL_SECTIONS;

// ----------------------------------------------------------------------------
// Shuffling (seedable so the check can pin it)
// ----------------------------------------------------------------------------

function shuffled<T>(items: T[], rng: Rng): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Indices 0..count-1 shuffled, never left in order (when there are two or more). */
export function shuffledOrder(count: number, rng: Rng = Math.random): number[] {
  const indices = Array.from({ length: count }, (_, i) => i);
  if (count < 2) return indices;
  const inOrder = (a: number[]) => a.every((v, i) => v === i);
  for (let attempt = 0; attempt < 5; attempt++) {
    const s = shuffled(indices, rng);
    if (!inOrder(s)) return s;
  }
  const forced = [...indices];
  [forced[0], forced[1]] = [forced[1], forced[0]];
  return forced;
}

// ----------------------------------------------------------------------------
// What a section is called
// ----------------------------------------------------------------------------

/** The first few words of a section's opening verse, for a section with no label. */
export function openingWords(section: DrillSection, script: TextScript = 'latin', count = 4): string {
  const opening = [...section.verses].sort((a, b) => a.verse - b.verse)[0];
  if (!opening) return '';
  const words = splitWords(opening.text, script);
  return words.slice(0, count).join(' ') + (words.length > count ? '…' : '');
}

/**
 * The name a tile or a choice carries: the user's label, else the opening
 * words of the section (never its verse range, which would hand over the
 * order in Put in order).
 */
export function sectionName(section: DrillSection, script: TextScript = 'latin'): string {
  return section.label?.trim() || openingWords(section, script);
}

// ----------------------------------------------------------------------------
// PUT IN ORDER
// ----------------------------------------------------------------------------

export interface OrderTile {
  /** The section's place in the drilled list, which is also the slot it belongs in. */
  correctIndex: number;
  text: string;
}

/** One tile per section, in the right order, plus the shuffled order they sit in the bank. */
export function buildOrderRound(
  sections: DrillSection[],
  script: TextScript = 'latin',
  rng: Rng = Math.random
): { tiles: OrderTile[]; bankOrder: number[] } {
  const tiles = sections.map((s, i) => ({ correctIndex: i, text: sectionName(s, script) }));
  return { tiles, bankOrder: shuffledOrder(tiles.length, rng) };
}

/** How the slots stand: `slots[i]` is the tile index placed in slot i, or null. */
export function scoreOrder(slots: (number | null)[], tiles: OrderTile[]) {
  const placed = slots.filter((s) => s !== null).length;
  const correct = slots.filter((t, slot) => t !== null && tiles[t]?.correctIndex === slot).length;
  return { placed, correct, allPlaced: tiles.length > 0 && placed === tiles.length, solved: tiles.length > 0 && correct === tiles.length };
}

// ----------------------------------------------------------------------------
// WHICH SECTION
// ----------------------------------------------------------------------------

export interface SectionQuestion {
  verse: DrillVerse;
  /** Position in the drilled section list of the verse's own section. */
  answer: number;
  /** Positions of the three sections offered, in the order shown. */
  choices: number[];
}

/**
 * The right section plus two neighbors: one above and one below when both
 * exist, otherwise the next two on the side that does. With exactly three
 * sections that is all of them. Returned in a shuffled order.
 */
export function choicesFor(answer: number, sectionCount: number, rng: Rng = Math.random): number[] {
  if (sectionCount <= 3) return shuffled(Array.from({ length: sectionCount }, (_, i) => i), rng);
  let others: number[];
  if (answer === 0) others = [1, 2];
  else if (answer === sectionCount - 1) others = [answer - 1, answer - 2];
  else others = [answer - 1, answer + 1];
  return shuffled([answer, ...others], rng);
}

/**
 * Verses to ask about: one from each section in turn (a random unused verse
 * of it) until `count` are picked or the verses run out, so every section is
 * asked about before any is asked twice. Returned in a shuffled order.
 */
export function pickQuestionVerses<V extends DrillVerse>(sections: DrillSection<V>[], count: number, rng: Rng = Math.random): { verse: V; section: number }[] {
  const pools = sections.map((s) => shuffled(s.verses, rng));
  const picked: { verse: V; section: number }[] = [];
  while (picked.length < count && pools.some((p) => p.length > 0)) {
    for (let i = 0; i < pools.length && picked.length < count; i++) {
      const next = pools[i].pop();
      if (next) picked.push({ verse: next, section: i });
    }
  }
  return shuffled(picked, rng);
}

/** A round of questions: `count` verses (default 8), each with its three choices. */
export function buildQuestions(sections: DrillSection[], count = 8, rng: Rng = Math.random): SectionQuestion[] {
  if (!hasEnoughSections(sections)) return [];
  return pickQuestionVerses(sections, count, rng).map(({ verse, section }) => ({
    verse,
    answer: section,
    choices: choicesFor(section, sections.length, rng),
  }));
}

/** What a choice shows: the label (or opening words) and, as a quiet second line, the verses. */
export function choiceText(section: DrillSection, script: TextScript = 'latin'): { name: string; range: string } {
  return { name: sectionName(section, script), range: sectionRangeText(section) };
}

// ----------------------------------------------------------------------------
// TEACH-IT
// ----------------------------------------------------------------------------

/** One fixed length, so there is nothing to set up (plan: "one fixed 10-second timer"). */
export const TEACH_SECONDS = 10;
export const TEACH_MS = TEACH_SECONDS * 1000;

/** How much of the timer has run, 0..1. */
export const teachProgress = (elapsedMs: number): number => Math.min(1, Math.max(0, elapsedMs / TEACH_MS));

/** Whole seconds left to show on the ring: 10 at the start, 0 when time is up. */
export const teachSecondsLeft = (elapsedMs: number): number => Math.max(0, Math.ceil((TEACH_MS - Math.max(0, elapsedMs)) / 1000));

export interface TeachTarget<V extends DrillVerse = DrillVerse> {
  key: string;
  /** Position of the section in the chapter, for its bracket color. Null for a stretch. */
  sectionIndex: number | null;
  label?: string;
  start: number;
  end: number;
  verses: V[];
}

/**
 * What can be taught: each section when the chapter has them, else short
 * stretches of the selection (as Pick up the thread cuts it). A section is
 * always worth teaching, so no minimum.
 */
export function teachTargets<V extends DrillVerse>(verses: V[], sections: DrillSection<V>[]): TeachTarget<V>[] {
  if (verses.length === 0) return [];
  if (sections.length >= 2) {
    return sections.map((s) => ({ key: `s${s.start}`, sectionIndex: s.index, label: s.label, start: s.start, end: s.end, verses: s.verses }));
  }
  return chapterStretches(verses).map((stretch) => ({
    key: `r${stretch[0].verse}-${stretch[stretch.length - 1].verse}`,
    sectionIndex: null,
    start: stretch[0].verse,
    end: stretch[stretch.length - 1].verse,
    verses: stretch,
  }));
}

/** A takeaway the user kept from a Teach-It round. Held inside the drill until stage 6 gives takeaways a home. */
export interface TakeawayDraft {
  id: string;
  book: string;
  chapter: number;
  sectionStart: number;
  sectionEnd: number;
  label?: string;
  text: string;
  createdAt: number;
}

/** A draft from what was said (or typed), or null when there is nothing to keep. */
export function makeTakeawayDraft(target: TeachTarget, text: string, now: number): TakeawayDraft | null {
  const clean = text.replace(/\s+/g, ' ').trim();
  const first = target.verses[0];
  if (!clean || !first) return null;
  return {
    id: `${first.book}|${first.chapter}|${target.start}|${now}`,
    book: first.book,
    chapter: first.chapter,
    sectionStart: target.start,
    sectionEnd: target.end,
    label: target.label,
    text: clean,
    createdAt: now,
  };
}

/** Adds a draft, replacing an earlier one for the same section (one draft per section, the latest). */
export function addDraft(drafts: TakeawayDraft[], draft: TakeawayDraft): TakeawayDraft[] {
  const same = (d: TakeawayDraft) => d.book === draft.book && d.chapter === draft.chapter && d.sectionStart === draft.sectionStart;
  return [...drafts.filter((d) => !same(d)), draft];
}

/** The spoken words as the drill shows them, tidied (one line, no stray spaces). */
export const tidyTranscript = (text: string): string => text.replace(/\s+/g, ' ').trim();
