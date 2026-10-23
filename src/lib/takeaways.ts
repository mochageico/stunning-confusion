import type { ChapterSections, QueueItem, Takeaway } from '../types';
import { ALL_BIBLE_BOOKS } from '../data';
import { normalizeDraft, sectionIndexOf, sectionRangeText, sectionsFromStarts } from './sections';
import { STAGE_ORDER, VerseStage, verseStage } from './stageProgress';

// ============================================================================
// TAKEAWAYS -- which sections are ready to ask, and the path's order
// ----------------------------------------------------------------------------
// MIXED_REVIEW_PLAN.md, stage 6. A takeaway is the main point of one section,
// in the user's own words. The app asks for it once, when every verse of the
// section has reached weekly reviews (or later). "Later" leaves an empty dashed
// stop on the path; Teach-It's "Save as takeaway draft" fills in the ask.
//
// Sections are the user's own (lib/sections.ts), so a chapter with none has no
// takeaways. A section's verses are the numbers from its start to its end; the
// last section ends on the highest verse of that chapter the user is learning
// (the sections doc doesn't record the chapter's end). A verse number in more
// than one translation counts at its furthest stage. Pure: no React, no
// Firestore. Tested by takeaways.check.ts.
// ============================================================================

/** The first stage that asks for a takeaway. */
export const READY_STAGE: VerseStage = 'weekly';

const rank = (stage: VerseStage): number => STAGE_ORDER.indexOf(stage);

/** Doc id and lookup key: one takeaway per section. */
export const takeawayId = (book: string, chapter: number, sectionStart: number): string => `${book}|${chapter}|${sectionStart}`;

export interface SectionStatus {
  book: string;
  chapter: number;
  /** Position in the chapter's sections (picks the bracket color). */
  index: number;
  start: number;
  end: number;
  label?: string;
  /** Every verse of the section is in the queue and at weekly or later. */
  ready: boolean;
  /** Verses in the section the user has (in any stage past waiting) / how many it has. */
  have: number;
  total: number;
  /** The least advanced verse's stage rank (-1 when a verse is missing or waiting). */
  floor: number;
}

export type SectionsFor = (book: string, chapter: number) => ChapterSections | null;

const bookOrder = (book: string): number => {
  const i = ALL_BIBLE_BOOKS.findIndex((b) => b.name === book);
  return i < 0 ? 999 : i;
};

const inOrder = (a: { book: string; chapter: number; start: number }, b: { book: string; chapter: number; start: number }): number =>
  bookOrder(a.book) - bookOrder(b.book) || a.chapter - b.chapter || a.start - b.start;

/** The user's sections, with a real section list (a doc holding only a placeholder start isn't one). */
function realSections(doc: ChapterSections | null, lastVerse: number) {
  if (!doc) return [];
  const draft = normalizeDraft(doc, 1, Math.max(1, lastVerse));
  if (draft.starts.length < 2) return [];
  return sectionsFromStarts(draft, lastVerse);
}

/**
 * Every section of every chapter the user is learning, with how far along
 * its verses are. Chapters with no sections of their own are left out.
 */
export function sectionStatuses(queue: QueueItem[], sectionsFor: SectionsFor): SectionStatus[] {
  // chapter -> verse number -> furthest stage rank
  const chapters = new Map<string, { book: string; chapter: number; verses: Map<number, number> }>();
  for (const q of queue) {
    const key = `${q.book}|${q.chapter}`;
    let c = chapters.get(key);
    if (!c) chapters.set(key, (c = { book: q.book, chapter: q.chapter, verses: new Map() }));
    const r = rank(verseStage(q));
    c.verses.set(q.verseNumber, Math.max(c.verses.get(q.verseNumber) ?? -1, r));
  }

  const out: SectionStatus[] = [];
  for (const c of chapters.values()) {
    const lastVerse = Math.max(...c.verses.keys());
    for (const s of realSections(sectionsFor(c.book, c.chapter), lastVerse)) {
      // A section with no verse of the user's in it is somebody else's passage.
      let have = 0;
      let floor = Infinity;
      const total = s.end - s.start + 1;
      for (let v = s.start; v <= s.end; v++) {
        const r = c.verses.get(v);
        if (r === undefined || r <= rank('waiting')) floor = -1;
        else {
          have++;
          floor = Math.min(floor, r);
        }
      }
      if (have === 0) continue;
      out.push({
        book: c.book,
        chapter: c.chapter,
        index: s.index,
        start: s.start,
        end: s.end,
        label: s.label,
        ready: floor >= rank(READY_STAGE),
        have,
        total,
        floor: floor === Infinity ? -1 : floor,
      });
    }
  }
  return out.sort(inOrder);
}

/** A takeaway that counts as written or deliberately put off (not a Teach-It draft). */
export const isStop = (t: Takeaway): boolean => t.status !== 'draft';

/** A finished takeaway: has words in it. */
export const isWritten = (t: Takeaway): boolean => isStop(t) && t.status !== 'later' && t.text.trim() !== '';

export interface PendingAsk extends SectionStatus {
  /** What a Teach-It draft or an earlier try left to fill in the ask with. */
  prefill: string;
  note: string;
}

/**
 * The sections that should be asked now: ready, and no takeaway yet. A
 * Teach-It draft doesn't count as a takeaway, it fills in the ask. A section
 * the user said "Later" to, or already wrote, is never asked again.
 */
export function pendingAsks(statuses: SectionStatus[], takeaways: Record<string, Takeaway>): PendingAsk[] {
  return statuses
    .filter((s) => s.ready)
    .flatMap((s) => {
      const t = takeaways[takeawayId(s.book, s.chapter, s.start)];
      if (t && isStop(t)) return [];
      return [{ ...s, prefill: t?.text ?? '', note: t?.note ?? '' }];
    });
}

/** The ask to show now, or null. The oldest chapter first, so they come in Bible order. */
export const nextAsk = (statuses: SectionStatus[], takeaways: Record<string, Takeaway>): PendingAsk | null =>
  pendingAsks(statuses, takeaways)[0] ?? null;

// ----------------------------------------------------------------------------
// The path
// ----------------------------------------------------------------------------

export type PathEntry =
  | { kind: 'chapter'; key: string; book: string; chapter: number }
  | { kind: 'stop'; key: string; side: 'left' | 'right'; takeaway: Takeaway; index: number; label?: string; range: string; empty: boolean }
  | { kind: 'next'; key: string; side: 'left' | 'right'; status: SectionStatus; range: string };

/**
 * The section that unlocks next: not yet at weekly, no takeaway yet, every
 * verse in the queue, and the furthest along. Ties go to the earlier passage.
 * Null when nothing is on its way.
 */
export function nextUp(statuses: SectionStatus[], takeaways: Record<string, Takeaway>): SectionStatus | null {
  const open = statuses.filter((s) => {
    if (s.ready || s.have < s.total) return false;
    const t = takeaways[takeawayId(s.book, s.chapter, s.start)];
    return !t || !isStop(t);
  });
  let best: SectionStatus | null = null;
  for (const s of open) if (!best || s.floor > best.floor) best = s;
  return best;
}

/**
 * The path, newest first: the next section waiting to unlock (dashed) on top,
 * then each takeaway or empty "Later" stop by when it was made, with a
 * chapter divider wherever the chapter changes. Stops alternate sides of the
 * line; the divider doesn't count toward the alternation.
 */
export function buildPath(takeaways: Record<string, Takeaway>, statuses: SectionStatus[], sectionsFor: SectionsFor): PathEntry[] {
  const stops = Object.values(takeaways)
    .filter(isStop)
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? 1 : -1));
  const next = nextUp(statuses, takeaways);

  const out: PathEntry[] = [];
  let n = 0;
  let lastChapter = '';
  const sideNow = (): 'left' | 'right' => (n++ % 2 === 0 ? 'left' : 'right');
  const divide = (book: string, chapter: number) => {
    const key = `${book}|${chapter}`;
    if (key !== lastChapter) out.push({ kind: 'chapter', key: `ch:${key}:${out.length}`, book, chapter });
    lastChapter = key;
  };

  if (next) {
    divide(next.book, next.chapter);
    out.push({ kind: 'next', key: `next:${takeawayId(next.book, next.chapter, next.start)}`, side: sideNow(), status: next, range: sectionRangeText(next) });
  }
  for (const t of stops) {
    divide(t.book, t.chapter);
    const doc = sectionsFor(t.book, t.chapter);
    const index = doc ? Math.max(0, sectionIndexOf(doc.starts, t.sectionStart)) : 0;
    out.push({
      kind: 'stop',
      key: t.id,
      side: sideNow(),
      takeaway: t,
      index,
      label: doc?.labels[t.sectionStart]?.trim() || t.label || undefined,
      range: sectionRangeText({ start: t.sectionStart, end: t.sectionEnd }),
      empty: !isWritten(t),
    });
  }
  return out;
}

/** How many takeaways are written, for a count on My Verses. */
export const writtenCount = (takeaways: Record<string, Takeaway>): number => Object.values(takeaways).filter(isWritten).length;

/** A new or changed doc for one section; `createdAt` is kept from `existing`. */
export function makeTakeaway(
  base: { book: string; chapter: number; sectionStart: number; sectionEnd: number; label?: string },
  fields: { text: string; note?: string; status: 'saved' | 'later' | 'draft' },
  existing: Takeaway | null | undefined,
  nowIso: string
): Takeaway {
  const note = fields.note?.replace(/\s+$/g, '').trim();
  return {
    id: takeawayId(base.book, base.chapter, base.sectionStart),
    book: base.book,
    chapter: base.chapter,
    sectionStart: base.sectionStart,
    sectionEnd: base.sectionEnd,
    ...(base.label?.trim() ? { label: base.label.trim() } : {}),
    text: fields.text.replace(/\s+/g, ' ').trim(),
    ...(note ? { note } : {}),
    status: fields.status,
    // A draft turning into a stop is a new stop on the path, so it is dated now.
    createdAt: existing && isStop(existing) ? existing.createdAt : nowIso,
    updatedAt: nowIso,
  };
}
