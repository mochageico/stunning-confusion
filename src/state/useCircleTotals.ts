import { useEffect, useRef, useState } from 'react';
import { AppState as RNAppState } from 'react-native';
import { collection, deleteDoc, doc, getDocs, query, setDoc, where } from 'firebase/firestore';

import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import type { CircleMemberStats, QueueItem } from '../types';
import { cleanStats, myWeekStats, weekBounds } from '../lib/circleTotals';

// ============================================================================
// CIRCLE TOTALS -- each member's week, shared with their circles
// ----------------------------------------------------------------------------
// circles/{circleId}/memberStats/{uid}: one small doc per member per circle
// (weekStart, reviewed, held, updatedAt). Why per circle and not one doc on
// the profile: a rule can't loop over every circle the reader is in, so a
// profile-side doc could only be gated by the self-reported circleIds (which
// no rule may trust). Inside the circle, "is the reader a member?" is one
// exists() on the real member doc, the same check shared takeaways use.
//
// Written here at app open (and each time the app comes back to the
// front) and after reviews (the queue changes, then a short wait so a
// session writes once, not per verse); skipped when nothing changed. The
// adding up is src/lib/circleTotals.ts.
// ============================================================================

/** How long the queue must sit still before the stats are written. */
const WRITE_DELAY_MS = 8000;

export interface CircleStatsState {
  stats: CircleMemberStats[];
  /** Takeaways shared to the circle since this week's Monday (just who and when). */
  sharedThisWeek: { authorUid: string; createdAt: string }[];
  loading: boolean;
}

interface CircleTotalsDeps {
  user: { uid: string } | null;
  memoryQueue: QueueItem[];
  /** True once this user's queue has loaded from Firestore (so an empty first render never writes "0 held"). */
  queueReady: boolean;
  circleIds: string[];
  dayStartHour: number;
}

export function useCircleTotals({ user, memoryQueue, queueReady, circleIds, dayStartHour }: CircleTotalsDeps) {
  const [circleStats, setCircleStats] = useState<Record<string, CircleStatsState>>({});
  // circleId -> what was last written there, so an unchanged week isn't rewritten.
  const lastWritten = useRef<Record<string, string>>({});
  // Bumped when the app comes back to the front: a new day or week may have begun.
  const [foregroundTick, setForegroundTick] = useState(0);

  useEffect(() => {
    if (!user?.uid) {
      setCircleStats({});
      lastWritten.current = {};
    }
  }, [user?.uid]);

  useEffect(() => {
    const sub = RNAppState.addEventListener('change', (s) => {
      if (s === 'active') setForegroundTick((n) => n + 1);
    });
    return () => sub.remove();
  }, []);

  const circleKey = [...circleIds].sort().join(',');
  useEffect(() => {
    const me = auth.currentUser;
    if (!me || !user?.uid || me.uid !== user.uid || !queueReady || circleIds.length === 0) return;
    const timer = setTimeout(() => {
      const mine = myWeekStats(memoryQueue, new Date(), dayStartHour);
      const body = JSON.stringify(mine);
      for (const circleId of circleIds) {
        if (lastWritten.current[circleId] === body) continue;
        const data: CircleMemberStats = { uid: me.uid, ...mine, updatedAt: new Date().toISOString() };
        setDoc(doc(db, 'circles', circleId, 'memberStats', me.uid), data)
          .then(() => (lastWritten.current[circleId] = body))
          .catch((err) => console.error('Failed to write circle stats:', err));
      }
    }, WRITE_DELAY_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.uid, memoryQueue, queueReady, circleKey, dayStartHour, foregroundTick]);

  /** Reads one circle's stats docs and this week's shared takeaways. Demo mode keeps what was seeded. */
  const loadCircleStats = async (circleId: string) => {
    if (!auth.currentUser) return;
    setCircleStats((prev) => ({ ...prev, [circleId]: { stats: prev[circleId]?.stats ?? [], sharedThisWeek: prev[circleId]?.sharedThisWeek ?? [], loading: true } }));
    const since = weekBounds(new Date(), dayStartHour).start.toISOString();
    try {
      const [statsSnap, takeawaysSnap] = await Promise.all([
        getDocs(collection(db, 'circles', circleId, 'memberStats')),
        getDocs(query(collection(db, 'circles', circleId, 'takeaways'), where('createdAt', '>=', since))),
      ]);
      setCircleStats((prev) => ({
        ...prev,
        [circleId]: {
          stats: statsSnap.docs.map((d) => cleanStats(d.id, d.data())),
          sharedThisWeek: takeawaysSnap.docs.map((d) => ({ authorUid: String(d.data().authorUid ?? ''), createdAt: String(d.data().createdAt ?? '') })),
          loading: false,
        },
      }));
    } catch (err) {
      // permission-denied here means this person is no longer in the circle (or the rule isn't deployed yet).
      setCircleStats((prev) => ({ ...prev, [circleId]: { stats: [], sharedThisWeek: [], loading: false } }));
      handleFirestoreError(err, OperationType.LIST, `circles/${circleId}/memberStats`);
    }
  };

  /** Takes your stats out of a circle (leaving). Best effort: the totals only count current members anyway. */
  const removeMyCircleStats = async (circleId: string) => {
    const me = auth.currentUser;
    delete lastWritten.current[circleId];
    if (!me) return;
    try {
      await deleteDoc(doc(db, 'circles', circleId, 'memberStats', me.uid));
    } catch (err) {
      console.error('Failed to remove circle stats:', err);
    }
  };

  /** Demo mode only: what a circle's load would have found. */
  const seedCircleStats = (circleId: string, stats: CircleMemberStats[], sharedThisWeek: { authorUid: string; createdAt: string }[]) => {
    setCircleStats((prev) => ({ ...prev, [circleId]: { stats, sharedThisWeek, loading: false } }));
  };

  return { circleStats, loadCircleStats, removeMyCircleStats, seedCircleStats };
}
