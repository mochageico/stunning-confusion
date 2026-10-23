import { useEffect, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { collection, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore';

import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import type { Takeaway } from '../types';
import { makeTakeaway } from '../lib/takeaways';
import { isShareable, shareChanges, sharedCopy, sharedTakeawayId } from '../lib/takeawaySharing';
import { removeSharedCopy } from './useCircleTakeaways';

// ============================================================================
// TAKEAWAYS
// ----------------------------------------------------------------------------
// The user's own takeaways, one small doc per section at
// users/{uid}/takeaways/{book|chapter|sectionStart}, owner-only in
// firestore.rules. Which sections are ready to ask, and the path's order, are
// in src/lib/takeaways.ts; this hook only loads and saves. Modeled on
// useChapterSections.
//
// Sharing: `sharedTo` on the doc lists circles; each gets a copy at
// circles/{circleId}/takeaways/{uid}_{id} (lib/takeawaySharing.ts decides
// which writes a save needs). The private doc is written first and is the
// source: a copy that fails to write is fixed by the next save.
// ============================================================================

/** The share switch's last choice (circle ids), on this device. */
const LAST_SHARE_KEY = 'takeaways:lastShare:v1';

interface TakeawaysDeps {
  user: { uid: string } | null;
}

/** What the ask and the opened takeaway hand to saveTakeaway. */
export interface TakeawaySpot {
  book: string;
  chapter: number;
  sectionStart: number;
  sectionEnd: number;
  label?: string;
  /** The section's position in the chapter (bracket color), for a shared copy. */
  index?: number;
}

export function useTakeaways({ user }: TakeawaysDeps) {
  const [takeaways, setTakeaways] = useState<Record<string, Takeaway>>({});
  // Reads inside async work see the latest, not the render they started in.
  const takeawaysRef = useRef(takeaways);
  takeawaysRef.current = takeaways;

  // The share switch remembers the last choice (empty = not shared).
  const [lastShareChoice, setLastShareChoiceState] = useState<string[]>([]);
  useEffect(() => {
    AsyncStorage.getItem(LAST_SHARE_KEY)
      .then((raw) => {
        const ids = raw ? JSON.parse(raw) : [];
        if (Array.isArray(ids)) setLastShareChoiceState(ids.filter((x) => typeof x === 'string'));
      })
      .catch(() => {});
  }, []);
  const setLastShareChoice = (ids: string[]) => {
    setLastShareChoiceState(ids);
    AsyncStorage.setItem(LAST_SHARE_KEY, JSON.stringify(ids)).catch(() => {});
  };

  /**
   * Brings the circles' copies in line with one save: writes (or rewrites,
   * after an edit) the copy in every shared circle, takes it out of the ones
   * no longer shared. Best effort per circle; signed out (demo) does nothing.
   */
  const syncShares = async (before: Takeaway | null | undefined, after: Takeaway | null, bracketIndex: number) => {
    const me = auth.currentUser;
    if (!me) return;
    const id = (after ?? before)?.id;
    if (!id) return;
    const { put, remove } = shareChanges(before?.sharedTo, after?.sharedTo, !!after && isShareable(after));
    const docId = sharedTakeawayId(me.uid, id);
    const author = { uid: me.uid, name: me.displayName || 'Someone' };
    await Promise.all([
      ...put.map(async (circleId) => {
        try {
          await setDoc(doc(db, 'circles', circleId, 'takeaways', docId), sharedCopy(after as Takeaway, author, bracketIndex));
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `circles/${circleId}/takeaways/${docId}`);
        }
      }),
      ...remove.map(async (circleId) => {
        try {
          await removeSharedCopy(circleId, docId);
        } catch (err) {
          // Already gone (e.g. the leader removed it with its author), or out of reach now.
          handleFirestoreError(err, OperationType.DELETE, `circles/${circleId}/takeaways/${docId}`);
        }
      }),
    ]);
  };

  // Signed out (or switched account): nothing of the last user's may linger.
  useEffect(() => {
    if (!user?.uid) setTakeaways({});
  }, [user?.uid]);

  /** Loads every takeaway; called from loadUserData. */
  const loadTakeaways = async (uid: string) => {
    try {
      const snap = await getDocs(collection(db, 'users', uid, 'takeaways'));
      const next: Record<string, Takeaway> = {};
      snap.docs.forEach((d) => {
        const data = d.data() as Takeaway;
        next[data.id ?? d.id] = { ...data, id: data.id ?? d.id };
      });
      setTakeaways(next);
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, `users/${uid}/takeaways`);
    }
  };

  /**
   * Writes one section's takeaway. `status` says what it is: 'saved' (the
   * main point), 'later' (the empty dashed stop) or 'draft' (from Teach-It).
   * Optimistic: the path shows it at once. Demo mode has no signed-in Firebase
   * user, so there the change stays on screen only.
   */
  const saveTakeaway = async (
    spot: TakeawaySpot,
    fields: { text: string; note?: string; status: 'saved' | 'later' | 'draft'; sharedTo?: string[] }
  ) => {
    const id = `${spot.book}|${spot.chapter}|${spot.sectionStart}`;
    const before = takeawaysRef.current[id];
    const record = makeTakeaway(spot, fields, before, new Date().toISOString());
    setTakeaways((prev) => ({ ...prev, [id]: record }));
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      // A whole-doc set, not a merge: a note that was cleared has to go.
      await setDoc(doc(db, 'users', uid, 'takeaways', id), record);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `users/${uid}/takeaways/${id}`);
      return;
    }
    if (before?.sharedTo?.length || record.sharedTo?.length) await syncShares(before, record, spot.index ?? 0);
  };

  /** Removes a takeaway or stop altogether (the section is then asked about again once ready). */
  const deleteTakeaway = async (id: string) => {
    const before = takeawaysRef.current[id];
    setTakeaways((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      await deleteDoc(doc(db, 'users', uid, 'takeaways', id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `users/${uid}/takeaways/${id}`);
    }
    // Out of every circle too, replies and all.
    if (before?.sharedTo?.length) await syncShares(before, null, 0);
  };

  /**
   * Leaving a circle: takes every takeaway out of it first, while still a
   * member (the replies under them can only be listed by a member), and
   * drops the circle from each doc's sharedTo.
   */
  const unshareFromCircle = async (circleId: string) => {
    const uid = auth.currentUser?.uid;
    const hit = Object.values(takeawaysRef.current).filter((t) => t.sharedTo?.includes(circleId));
    for (const t of hit) {
      const next: Takeaway = { ...t, sharedTo: (t.sharedTo ?? []).filter((c) => c !== circleId) };
      if (!next.sharedTo?.length) delete next.sharedTo;
      setTakeaways((prev) => ({ ...prev, [t.id]: next }));
      if (!uid) continue;
      try {
        await removeSharedCopy(circleId, sharedTakeawayId(uid, t.id));
      } catch (err) {
        handleFirestoreError(err, OperationType.DELETE, `circles/${circleId}/takeaways/${sharedTakeawayId(uid, t.id)}`);
      }
      try {
        await setDoc(doc(db, 'users', uid, 'takeaways', t.id), next);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, `users/${uid}/takeaways/${t.id}`);
      }
    }
  };

  /** Deleting the account: every shared copy, in every circle, before the private docs go. */
  const removeAllSharedTakeaways = async () => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    for (const t of Object.values(takeawaysRef.current)) {
      for (const circleId of t.sharedTo ?? []) {
        try {
          await removeSharedCopy(circleId, sharedTakeawayId(uid, t.id));
        } catch (err) {
          handleFirestoreError(err, OperationType.DELETE, `circles/${circleId}/takeaways/${sharedTakeawayId(uid, t.id)}`);
        }
      }
    }
  };

  return {
    takeaways,
    loadTakeaways,
    saveTakeaway,
    deleteTakeaway,
    lastShareChoice,
    setLastShareChoice,
    unshareFromCircle,
    removeAllSharedTakeaways,
  };
}
