import type { ChapterSections, TextScript } from '../types';
import { buildThreadPassages, DrillVerse } from './drills';
import { normalizeToken, splitWords } from './textScript';

// ============================================================================
// CHAPTER SECTIONS
// ----------------------------------------------------------------------------
// The user splits a chapter into sections by dragging bracket edges on the
// chapter page. Mixed review, Outline and the takeaways path all walk a
// chapter section by section, so everything that reads or changes sections
// goes through here. Pure: no React, no Firestore (MIXED_REVIEW_PLAN.md,
// stage 1; tested by sections.check.ts).
//
// A chapter's sections are just their start verses. Section i runs from
// starts[i] up to the verse before starts[i + 1]; the last runs to the end of
// the chapter. Labels and memory-phrase words are keyed by start verse, so
// every change to the starts has to carry them along -- see moveStart.
//
// Verse numbers, not positions in a verse list: some translations leave a
// verse out (Matthew 17:21), and the numbers stay meaningful when they do.
// Hebrew/Greek use English verse numbering in this app, so one set of
// sections serves every translation of a chapter.
// ============================================================================

/** The Firestore doc id and lookup key for a chapter's sections. */
export const chapterSectionsKey = (book: string, chapter: number): string => `${book}|${chapter}`;

/** The editable part of a ChapterSections doc. */
export type SectionDraft = Pick<ChapterSections, 'starts' | 'labels' | 'phraseWords'>;

export interface Section {
  index: number;
  /** First verse number. */
  start: number;
  /** Last verse number, inclusive. */
  end: number;
  label?: string;
  phraseWord?: string;
}

/** A chapter with no sections yet: one that covers it all. */
export const emptyDraft = (firstVerse: number): SectionDraft => ({ starts: [firstVerse], labels: {}, phraseWords: {} });

/**
 * Starts as stored can drift from the chapter in front of us (a translation
 * missing a verse, a hand-edited doc): sorted, de-duplicated, inside
 * [firstVerse, lastVerse], and always opening on firstVerse.
 */
export function normalizeStarts(starts: number[], firstVerse: number, lastVerse: number): number[] {
  const inRange = starts.filter((s) => Number.isInteger(s) && s > firstVerse && s <= lastVerse);
  return [firstVerse, ...Array.from(new Set(inRange)).sort((a, b) => a - b)];
}

/** Only the labels/words whose start still exists, with blanks dropped. */
function keepFor(starts: number[], byStart: Record<number, string>): Record<number, string> {
  const out: Record<number, string> = {};
  for (const s of starts) {
    const v = byStart[s]?.trim();
    if (v) out[s] = byStart[s];
  }
  return out;
}

/** normalizeStarts for a whole draft, dropping labels and words left without a section. */
export function normalizeDraft(draft: SectionDraft, firstVerse: number, lastVerse: number): SectionDraft {
  const starts = normalizeStarts(draft.starts, firstVerse, lastVerse);
  return { starts, labels: keepFor(starts, draft.labels), phraseWords: keepFor(starts, draft.phraseWords) };
}

/** The sections, in order, each with its verse range, label and phrase word. */
export function sectionsFromStarts(draft: SectionDraft, lastVerse: number): Section[] {
  return draft.starts.map((start, index) => ({
    index,
    start,
    end: index + 1 < draft.starts.length ? draft.starts[index + 1] - 1 : lastVerse,
    label: draft.labels[start]?.trim() || undefined,
    phraseWord: draft.phraseWords[start]?.trim() || undefined,
  }));
}

/** Which section a verse falls in, or -1 for a verse before the first start. */
export function sectionIndexOf(starts: number[], verse: number): number {
  let found = -1;
  for (let i = 0; i < starts.length; i++) {
    if (starts[i] <= verse) found = i;
    else break;
  }
  return found;
}

/**
 * Where start `index` may move to: strictly after the start before it, and
 * leaving at least one verse for the section after it (or the chapter's last
 * verse when it's the last section). The first start never moves -- it's the
 * chapter's first verse -- so its range is just itself.
 */
export function startBounds(starts: number[], index: number, lastVerse: number): { min: number; max: number } {
  if (index <= 0) return { min: starts[0], max: starts[0] };
  const min = starts[index - 1] + 1;
  const max = index + 1 < starts.length ? starts[index + 1] - 1 : lastVerse;
  return { min, max };
}

/** A copy of `byStart` with the entry at `from` moved to `to`. */
function rekey(byStart: Record<number, string>, from: number, to: number): Record<number, string> {
  if (from === to || byStart[from] === undefined) return byStart;
  const out = { ...byStart };
  out[to] = out[from];
  delete out[from];
  return out;
}

/**
 * Drags start `index` to `toVerse`, clamped between its neighbors (dragging a
 * bracket edge past the next one stops at it rather than swallowing a
 * section). The section's label and phrase word move with it: they belong to
 * the section, not to the verse it used to start on.
 */
export function moveStart(draft: SectionDraft, index: number, toVerse: number, lastVerse: number): SectionDraft {
  if (index <= 0 || index >= draft.starts.length) return draft;
  const { min, max } = startBounds(draft.starts, index, lastVerse);
  const to = Math.min(max, Math.max(min, Math.round(toVerse)));
  const from = draft.starts[index];
  if (to === from) return draft;
  const starts = draft.starts.slice();
  starts[index] = to;
  return { starts, labels: rekey(draft.labels, from, to), phraseWords: rekey(draft.phraseWords, from, to) };
}

/**
 * Starts a new section at `verse`. The section it was in keeps its label and
 * word; the new one starts blank. No change for the chapter's first verse, a
 * verse that already starts a section, or one outside the chapter.
 */
export function splitAt(draft: SectionDraft, verse: number, lastVerse: number): SectionDraft {
  if (verse <= draft.starts[0] || verse > lastVerse || draft.starts.includes(verse)) return draft;
  const starts = [...draft.starts, verse].sort((a, b) => a - b);
  return { starts, labels: draft.labels, phraseWords: draft.phraseWords };
}

/**
 * Joins section `index` onto the one above it. The joined section keeps the
 * upper one's label and word; if the upper had none, it takes the lower one's
 * rather than throwing away something the user typed.
 */
export function mergeAt(draft: SectionDraft, index: number): SectionDraft {
  if (index <= 0 || index >= draft.starts.length) return draft;
  const gone = draft.starts[index];
  const upper = draft.starts[index - 1];
  const fold = (byStart: Record<number, string>) => {
    const out = { ...byStart };
    if (!out[upper]?.trim() && out[gone]?.trim()) out[upper] = out[gone];
    delete out[gone];
    return out;
  };
  return {
    starts: draft.starts.filter((_, i) => i !== index),
    labels: fold(draft.labels),
    phraseWords: fold(draft.phraseWords),
  };
}

/** Sets (or, with blank text, clears) the label or phrase word of the section starting at `start`. */
export function setSectionText(
  draft: SectionDraft,
  field: 'labels' | 'phraseWords',
  start: number,
  text: string
): SectionDraft {
  const next = { ...draft[field] };
  if (text.trim()) next[start] = text;
  else delete next[start];
  return { ...draft, [field]: next };
}

/** Whether a draft says nothing worth saving: one section, no label, no word. */
export function isBlankDraft(draft: SectionDraft): boolean {
  return (
    draft.starts.length <= 1 &&
    !Object.values(draft.labels).some((t) => t?.trim()) &&
    !Object.values(draft.phraseWords).some((t) => t?.trim())
  );
}

/** Two drafts describe the same sections. Used to tell whether editing changed anything. */
export function sameDraft(a: SectionDraft, b: SectionDraft): boolean {
  const sameMap = (x: Record<number, string>, y: Record<number, string>) => {
    const xs = Object.entries(x).filter(([, v]) => v?.trim());
    const ys = Object.entries(y).filter(([, v]) => v?.trim());
    return xs.length === ys.length && xs.every(([k, v]) => y[Number(k)]?.trim() === v.trim());
  };
  return (
    a.starts.length === b.starts.length &&
    a.starts.every((s, i) => s === b.starts[i]) &&
    sameMap(a.labels, b.labels) &&
    sameMap(a.phraseWords, b.phraseWords)
  );
}

/** "Verse 6" or "Verses 1–5". */
export function sectionRangeText(section: Pick<Section, 'start' | 'end'>): string {
  return section.start === section.end ? `Verse ${section.start}` : `Verses ${section.start}–${section.end}`;
}

/**
 * The memory-phrase letter for each section: the first letter of the first
 * word of its opening verse, bare (no accents or vowel points, Greek in lower
 * case, Hebrew final forms folded), the same letter the first-letter hints
 * show. A section whose start verse is missing from this translation opens on
 * the next verse it has. '' when there's no text to read a letter from.
 */
export function phraseLetters(
  sections: Pick<Section, 'start' | 'end'>[],
  verses: { verse: number; text: string }[],
  script: TextScript = 'latin'
): string[] {
  return sections.map((section) => {
    const opening = verses
      .filter((v) => v.verse >= section.start && v.verse <= section.end)
      .sort((a, b) => a.verse - b.verse)[0];
    if (!opening) return '';
    for (const word of splitWords(opening.text, script)) {
      const bare = normalizeToken(word, script);
      if (bare) return Array.from(bare)[0];
    }
    return '';
  });
}

/** Verses per stretch when a chapter has no sections of its own. */
export const STRETCH_VERSES = 4;

/**
 * Stand-in sections for a chapter the user hasn't split: short runs of about
 * STRETCH_VERSES verses, cut the same way Pick up the thread cuts a long range
 * (buildThreadPassages). Neighboring stretches share their joining verse, so
 * the joins get practiced too -- which also means a verse can sit in two
 * stretches, unlike real sections.
 */
export function chapterStretches<V extends DrillVerse>(verses: V[], size: number = STRETCH_VERSES): V[][] {
  if (verses.length === 1) return [verses];
  return buildThreadPassages(verses, () => true, size);
}
