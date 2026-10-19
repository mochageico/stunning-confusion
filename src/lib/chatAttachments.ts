// ============================================================================
// CHAT CARDS
// ----------------------------------------------------------------------------
// A chat message can carry one card besides its text: a verse, a shared
// recording, a request for a recording, or a quiz. The card lives on the
// message doc as `attachment` (firestore.rules checks only its shape); the
// message's `text` is always a readable one-line fallback, so the inbox
// preview, push notifications and an older app build all still make sense.
//
// Answers to a request or quiz are separate docs (ChatResponse), one per
// person per message, so the card's state can change without editing the
// message -- messages are never editable.
// ============================================================================

export interface VerseAttachment {
  kind: 'verse';
  translationId: string;
  book: string;
  bookId: string;
  chapter: number;
  startVerse: number;
  endVerse: number;
}

export interface RecordingAttachment {
  kind: 'recording';
  /** sharedRecordings/{id} -- readable to the people it was shared into. */
  sharedRecordingId: string;
  book: string;
  chapter: number;
  startVerse?: number;
  endVerse?: number;
  translation: string;
  duration: number;
  ownerName: string;
}

/** "Will you record this?" -- in a DM to that person, in a circle to anyone. */
export interface RecordingRequestAttachment {
  kind: 'recordingRequest';
  book: string;
  chapter: number;
  startVerse?: number;
  endVerse?: number;
}

/** A friend quizzing you on one of your own verses. Practice only. */
export interface QuizAttachment {
  kind: 'quiz';
  toUid: string;
  translationId: string;
  book: string;
  bookId: string;
  chapter: number;
  verse: number;
  /** Share of words hidden, 0-100. */
  hidePercent: number;
}

export type ChatAttachment = VerseAttachment | RecordingAttachment | RecordingRequestAttachment | QuizAttachment;

/**
 * One person's answer to a request or quiz card, stored flat beside the
 * messages as `${messageId}_${uid}` (same pattern as reactions).
 * - request: 'willDo' / 'notNow', then 'done' with the recording once saved
 * - quiz:    'done' with the score
 */
export interface ChatResponse {
  id: string;
  messageId: string;
  uid: string;
  name: string;
  status: 'willDo' | 'notNow' | 'done';
  sharedRecordingId?: string;
  /** Quiz: share of words right, 0-100. */
  score?: number;
  updatedAt: string;
}

/** "Romans 8", "Romans 8:28", "Romans 8:28-30". */
export function passageLabel(p: { book: string; chapter: number; startVerse?: number; endVerse?: number }): string {
  if (p.startVerse === undefined) return `${p.book} ${p.chapter}`;
  const end = p.endVerse ?? p.startVerse;
  return `${p.book} ${p.chapter}:${p.startVerse}${end !== p.startVerse ? `-${end}` : ''}`;
}

/** The message text that travels with a card (inbox preview, push, old builds). */
export function attachmentFallbackText(a: ChatAttachment, senderName: string): string {
  switch (a.kind) {
    case 'verse':
      return `Shared ${passageLabel(a)} (${a.translationId})`;
    case 'recording':
      return `Shared a recording of ${passageLabel(a)}`;
    case 'recordingRequest':
      return `Asked for a recording of ${passageLabel(a)}`;
    case 'quiz':
      return `${senderName} quizzed you on ${a.book} ${a.chapter}:${a.verse}`;
  }
}

/** Firestore rejects explicit undefined fields; drop them before writing. */
export function cleanAttachment<T extends ChatAttachment>(a: T): T {
  return Object.fromEntries(Object.entries(a).filter(([, v]) => v !== undefined)) as T;
}

/** Quiz: which word positions stay visible for a given share hidden. Seeded so both phones agree. */
export function quizShownWords(wordCount: number, hidePercent: number, seed: string): Set<number> {
  const toShow = Math.round((wordCount * (100 - hidePercent)) / 100);
  // Small deterministic shuffle (mulberry32 on a string hash) -- the quiz
  // looks the same if it's reopened, and nothing here needs to be secure.
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let t = h >>> 0;
  const rand = () => {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
  const order = Array.from({ length: wordCount }, (_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  return new Set(order.slice(0, toShow));
}
