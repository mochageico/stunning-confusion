import { useEffect, useState } from 'react';
import { addDoc, collection, deleteDoc, doc, getDocs, limit, onSnapshot, orderBy, query, where, writeBatch } from 'firebase/firestore';

import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import type { SharedTakeaway, TakeawayReply } from '../types';
import { AUTHOR_NAME_MAX, cleanReply, REPLY_MAX } from '../lib/takeawaySharing';

// ============================================================================
// TAKEAWAYS SHARED WITH A CIRCLE -- the "With my circle" side
// ----------------------------------------------------------------------------
// circles/{circleId}/takeaways/{authorUid}_{takeawayId} (written by each
// author's useTakeaways) and their replies/{replyId}; members-only in
// firestore.rules. This hook reads a circle's list (with every takeaway's
// replies, for the counts), watches the replies of the one that's open, and
// sends and deletes replies. The list's filtering (blocked people, former
// members) is src/lib/takeawaySharing.ts's circleList.
//
// Leaving or being removed from a circle hides its takeaways: the rules stop
// the reads, and the screen only offers circles in myCircles.
// ============================================================================

/** How many of a circle's takeaways one load reads, newest first. */
const LIST_LIMIT = 100;

export interface CircleTakeawayList {
  items: SharedTakeaway[];
  /** The circle's members when loaded, to leave out people who left; null = unknown. */
  memberUids: string[] | null;
  loading: boolean;
}

/** Replies key: one takeaway in one circle. */
export const replyKey = (circleId: string, docId: string): string => `${circleId}/${docId}`;

const toShared = (circleId: string, id: string, data: any): SharedTakeaway => ({ ...(data as SharedTakeaway), id, circleId });
const toReply = (id: string, data: any): TakeawayReply => ({ id, fromUid: data.fromUid, fromName: data.fromName ?? 'Someone', text: data.text ?? '', createdAt: data.createdAt ?? '' });

/**
 * Takes one shared copy out of a circle, replies first (a reply's delete rule
 * reads its takeaway, and replies can't outlive it). The caller must be the
 * author or the circle's leader, and still a member to list the replies; a
 * former member's replies can't be listed, so only the copy itself goes.
 */
export async function removeSharedCopy(circleId: string, docId: string): Promise<void> {
  const ref = doc(db, 'circles', circleId, 'takeaways', docId);
  let replyRefs: ReturnType<typeof doc>[] = [];
  try {
    replyRefs = (await getDocs(collection(ref, 'replies'))).docs.map((d) => d.ref);
  } catch {
    // Not a member any more: the replies are out of reach for everyone who left too.
  }
  const BATCH_LIMIT = 450;
  for (let i = 0; i < replyRefs.length; i += BATCH_LIMIT) {
    const batch = writeBatch(db);
    replyRefs.slice(i, i + BATCH_LIMIT).forEach((r) => batch.delete(r));
    await batch.commit();
  }
  await deleteDoc(ref);
}

/**
 * Every takeaway one person shared with a circle, gone (the leader removing a
 * member). Best effort, one copy at a time: a failure leaves the rest, and the
 * circle's list already hides people who aren't members.
 */
export async function removeSharesBy(circleId: string, authorUid: string): Promise<void> {
  const snap = await getDocs(query(collection(db, 'circles', circleId, 'takeaways'), where('authorUid', '==', authorUid)));
  for (const d of snap.docs) {
    try {
      await removeSharedCopy(circleId, d.id);
    } catch (err) {
      console.error('Failed to remove a shared takeaway:', err);
    }
  }
}

interface CircleTakeawaysDeps {
  user: { uid: string } | null;
  triggerToast: (message: string) => void;
}

export function useCircleTakeaways({ user, triggerToast }: CircleTakeawaysDeps) {
  const [circleTakeaways, setCircleTakeaways] = useState<Record<string, CircleTakeawayList>>({});
  const [takeawayReplies, setTakeawayReplies] = useState<Record<string, TakeawayReply[]>>({});

  // Signed out (or switched account): nothing of the last user's circles may linger.
  useEffect(() => {
    if (!user?.uid) {
      setCircleTakeaways({});
      setTakeawayReplies({});
    }
  }, [user?.uid]);

  /**
   * Loads one circle's takeaways, its member list, and each takeaway's
   * replies (for the counts). Demo mode has no Firebase user, so it keeps
   * whatever seedCircleTakeaways put there.
   */
  const loadCircleTakeaways = async (circleId: string) => {
    if (!auth.currentUser) return;
    setCircleTakeaways((prev) => ({ ...prev, [circleId]: { items: prev[circleId]?.items ?? [], memberUids: prev[circleId]?.memberUids ?? null, loading: true } }));
    try {
      const [listSnap, membersSnap] = await Promise.all([
        getDocs(query(collection(db, 'circles', circleId, 'takeaways'), orderBy('createdAt', 'desc'), limit(LIST_LIMIT))),
        getDocs(collection(db, 'circles', circleId, 'members')),
      ]);
      const items = listSnap.docs.map((d) => toShared(circleId, d.id, d.data()));
      const replies = await Promise.all(
        listSnap.docs.map(async (d) => {
          try {
            return (await getDocs(collection(d.ref, 'replies'))).docs.map((r) => toReply(r.id, r.data()));
          } catch {
            return [];
          }
        })
      );
      setTakeawayReplies((prev) => {
        const next = { ...prev };
        items.forEach((t, i) => (next[replyKey(circleId, t.id)] = replies[i]));
        return next;
      });
      setCircleTakeaways((prev) => ({ ...prev, [circleId]: { items, memberUids: membersSnap.docs.map((d) => d.id), loading: false } }));
    } catch (err) {
      // permission-denied here means this person is no longer in the circle.
      setCircleTakeaways((prev) => ({ ...prev, [circleId]: { items: [], memberUids: null, loading: false } }));
      handleFirestoreError(err, OperationType.LIST, `circles/${circleId}/takeaways`);
    }
  };

  /** Live replies for the takeaway that's open. Returns the unsubscribe. */
  const watchTakeawayReplies = (circleId: string, docId: string): (() => void) => {
    if (!auth.currentUser) return () => {};
    return onSnapshot(
      query(collection(db, 'circles', circleId, 'takeaways', docId, 'replies'), orderBy('createdAt', 'asc')),
      (snap) => setTakeawayReplies((prev) => ({ ...prev, [replyKey(circleId, docId)]: snap.docs.map((r) => toReply(r.id, r.data())) })),
      (err) => console.error('Failed to watch takeaway replies:', err)
    );
  };

  /** Sends a reply. False (and a toast) when it can't go. */
  const postTakeawayReply = async (circleId: string, docId: string, text: string): Promise<boolean> => {
    const clean = cleanReply(text);
    if (!clean) {
      if (text.trim().length > REPLY_MAX) triggerToast(`Replies can be up to ${REPLY_MAX} characters.`);
      return false;
    }
    const me = auth.currentUser;
    const reply = {
      fromUid: me?.uid ?? user?.uid ?? 'demo',
      fromName: (me?.displayName || 'Someone').slice(0, AUTHOR_NAME_MAX),
      text: clean,
      createdAt: new Date().toISOString(),
    };
    const key = replyKey(circleId, docId);
    if (!me) {
      // Demo mode: on screen only.
      setTakeawayReplies((prev) => ({ ...prev, [key]: [...(prev[key] ?? []), { id: `local${Date.now()}`, ...reply, fromName: 'Micah' }] }));
      return true;
    }
    try {
      await addDoc(collection(db, 'circles', circleId, 'takeaways', docId, 'replies'), reply);
      return true;
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `circles/${circleId}/takeaways/${docId}/replies`);
      triggerToast("Couldn't send that reply. Try again.");
      return false;
    }
  };

  /** Deletes one of your own replies. */
  const deleteTakeawayReply = async (circleId: string, docId: string, replyId: string) => {
    const key = replyKey(circleId, docId);
    setTakeawayReplies((prev) => ({ ...prev, [key]: (prev[key] ?? []).filter((r) => r.id !== replyId) }));
    if (!auth.currentUser) return;
    try {
      await deleteDoc(doc(db, 'circles', circleId, 'takeaways', docId, 'replies', replyId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `circles/${circleId}/takeaways/${docId}/replies/${replyId}`);
    }
  };

  /** Demo mode only: what a circle's load would have found. */
  const seedCircleTakeaways = (circleId: string, items: SharedTakeaway[], memberUids: string[], replies: Record<string, TakeawayReply[]>) => {
    setCircleTakeaways((prev) => ({ ...prev, [circleId]: { items, memberUids, loading: false } }));
    setTakeawayReplies((prev) => {
      const next = { ...prev };
      for (const [docId, list] of Object.entries(replies)) next[replyKey(circleId, docId)] = list;
      return next;
    });
  };

  return {
    circleTakeaways,
    takeawayReplies,
    loadCircleTakeaways,
    watchTakeawayReplies,
    postTakeawayReply,
    deleteTakeawayReply,
    seedCircleTakeaways,
  };
}
