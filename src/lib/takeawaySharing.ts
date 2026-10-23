import type { SharedTakeaway, Takeaway, TakeawayReply } from '../types';
import { isWritten } from './takeaways';

// ============================================================================
// TAKEAWAYS -- sharing with a circle
// ----------------------------------------------------------------------------
// MIXED_REVIEW_PLAN.md, stage 6, second half. The private doc at
// users/{uid}/takeaways/{id} stays the source of truth; sharing it with a
// circle ALSO writes a copy to circles/{circleId}/takeaways/{uid}_{id} (like
// sharedRecordings), and `sharedTo` on the private doc lists those circles.
// Replies live under the copy. Which circles to write to or remove from, what
// the copy holds, and what a circle's list shows are worked out here. Pure:
// no React, no Firestore. Tested by takeawaySharing.check.ts.
// ============================================================================

/** Caps, the same numbers firestore.rules checks. */
export const SHARED_TEXT_MAX = 2000;
export const SHARED_LABEL_MAX = 120;
export const AUTHOR_NAME_MAX = 100;
export const REPLY_MAX = 500;

/**
 * The shared copy's doc id. Two people can both have a takeaway for Matthew
 * 7:1, so the author's uid leads; the rules check that prefix, so nobody can
 * squat the id someone else's share will need.
 */
export const sharedTakeawayId = (authorUid: string, takeawayId: string): string => `${authorUid}_${takeawayId}`;

/** Only a written takeaway goes to a circle: never a "Later" stop or a Teach-It draft. */
export const isShareable = (t: Takeaway): boolean => isWritten(t);

/** Circle ids, once each, in a fixed order (so a save that changes nothing writes the same array). */
const tidy = (ids: readonly string[]): string[] => [...new Set(ids.filter((id) => typeof id === 'string' && id))].sort();

/**
 * The takeaway's circles after the switch was saved. `offered` is the circles
 * the switch showed (the user's circles); `choice` is the ones switched on.
 * A circle the switch didn't offer is left as it was: if the circle list
 * hadn't loaded yet, saving must not quietly unshare everything.
 */
export function nextSharedTo(prev: readonly string[] | undefined, choice: readonly string[], offered: readonly string[]): string[] {
  const shown = new Set(offered);
  return tidy([...(prev ?? []).filter((id) => !shown.has(id)), ...choice.filter((id) => shown.has(id))]);
}

/** What the switch starts on for a takeaway already written: its circles that the user is still in. */
export const sharedChoiceFor = (t: Pick<Takeaway, 'sharedTo'> | null | undefined, offered: readonly string[]): string[] =>
  tidy((t?.sharedTo ?? []).filter((id) => offered.includes(id)));

/** What the switch starts on for a new takeaway: the last choice, minus circles since left. */
export const rememberedChoice = (last: readonly string[] | null | undefined, offered: readonly string[]): string[] =>
  tidy((last ?? []).filter((id) => offered.includes(id)));

/**
 * The writes one save needs: `put` (write or rewrite the copy in these
 * circles, so an edit reaches them) and `remove` (take the copy and its
 * replies out). A takeaway that isn't shareable any more comes out of every
 * circle it was in.
 */
export function shareChanges(before: readonly string[] | undefined, after: readonly string[] | undefined, shareable: boolean): { put: string[]; remove: string[] } {
  const was = tidy(before ?? []);
  const now = shareable ? tidy(after ?? []) : [];
  return { put: now, remove: was.filter((id) => !now.includes(id)) };
}

const clip = (s: string, max: number): string => (s.length > max ? s.slice(0, max) : s);

/**
 * The shared copy's fields (the doc body; the circle is in the path). The
 * note goes too: it shows on the opened takeaway, above the replies. Only the
 * fields the rules allow, each within its cap.
 */
export function sharedCopy(t: Takeaway, author: { uid: string; name: string }, bracketIndex: number): Omit<SharedTakeaway, 'id' | 'circleId'> {
  const label = t.label?.trim();
  const note = t.note?.trim();
  return {
    takeawayId: t.id,
    authorUid: author.uid,
    authorName: clip(author.name.trim() || 'Someone', AUTHOR_NAME_MAX),
    book: t.book,
    chapter: t.chapter,
    sectionStart: t.sectionStart,
    sectionEnd: t.sectionEnd,
    ...(label ? { label: clip(label, SHARED_LABEL_MAX) } : {}),
    bracketIndex: Math.max(0, Math.floor(bracketIndex) || 0),
    text: clip(t.text.trim(), SHARED_TEXT_MAX),
    ...(note ? { note: clip(note, SHARED_TEXT_MAX) } : {}),
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
}

/**
 * A circle's list: each person's takeaways as their own items, newest first,
 * never grouped by passage. Left out: anyone the viewer blocked (like circle
 * chat, a block only hides them on the blocker's own screen), and anyone no
 * longer in the circle (someone who left or was removed). `memberUids` null
 * means the member list isn't known, so nobody is left out for that.
 */
export function circleList(items: readonly SharedTakeaway[], opts: { blockedUids: ReadonlySet<string>; memberUids: readonly string[] | null }): SharedTakeaway[] {
  const members = opts.memberUids ? new Set(opts.memberUids) : null;
  return items
    .filter((t) => !opts.blockedUids.has(t.authorUid) && (!members || members.has(t.authorUid)))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : a.id < b.id ? -1 : 1));
}

/** The replies the viewer sees, oldest first (a conversation), blocked people left out. */
export const visibleReplies = (replies: readonly TakeawayReply[], blockedUids: ReadonlySet<string>): TakeawayReply[] =>
  replies
    .filter((r) => !blockedUids.has(r.fromUid))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1));

/** "No replies yet" / "1 reply" / "3 replies" */
export const replyCountText = (n: number): string => (n <= 0 ? 'No replies yet' : n === 1 ? '1 reply' : `${n} replies`);

/** A reply as sent: trimmed, or null when there's nothing to send or it's too long. */
export function cleanReply(text: string): string | null {
  const t = text.trim();
  if (!t || t.length > REPLY_MAX) return null;
  return t;
}

/** "Sarah" from "Sarah Miller"; "You" for the viewer. */
export const authorShort = (t: Pick<SharedTakeaway, 'authorUid' | 'authorName'>, myUid: string | null | undefined): string =>
  t.authorUid === myUid ? 'You' : t.authorName.trim().split(/\s+/)[0] || 'Someone';
