import { useEffect, useRef, useState } from 'react';
import { collection, doc, getDoc, getDocs, setDoc } from 'firebase/firestore';

import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import type { CircleDailyEntry, GroupPlan, GroupPlanMembership, QueueItem } from '../types';
import { scheduledDue } from '../lib/groupPlanScheduler';
import { DAY_ABBREVS, getLogicalDate, localDayKey } from '../lib/logicalDate';

// ============================================================================
// WHO STARTED TODAY'S VERSES
// ----------------------------------------------------------------------------
// Opt-in, per circle. A member who turns it on writes one small doc,
// circles/{id}/dailyProgress/{uid}, saying only whether they have started the
// verses their circle's plans handed out today. Nothing about reviews, scores
// or what was learned. Members who haven't opted in write nothing, and are
// only ever counted, never named.
// ============================================================================

interface CircleDailyDeps {
  user: { uid: string } | null;
  myCircleIds: string[];
  joinedPlans: GroupPlan[];
  memberships: GroupPlanMembership[];
  memoryQueue: QueueItem[];
  dayStartHour: number;
  sabbathEnabled: boolean;
  sabbathDay: string;
}

type DailyState = { entries: CircleDailyEntry[]; loading: boolean };

/** Today's scheduled verses for one circle: is there a plan day, and is everything for it started? */
export function circleDayStatus(
  circleId: string,
  plans: GroupPlan[],
  memberships: GroupPlanMembership[],
  queue: QueueItem[],
  today: Date
): { relevant: boolean; done: boolean } {
  const mine = plans.filter((p) => p.circleId === circleId && p.days && p.days.length > 0 && memberships.some((m) => m.planId === p.planId));
  let relevant = false;
  let done = true;
  for (const plan of mine) {
    const m = memberships.find((x) => x.planId === plan.planId);
    const due = scheduledDue(queue, plan, today, m?.joinedAt)?.due ?? 0;
    const planDay = plan.days!.includes(DAY_ABBREVS[today.getDay()]);
    if (planDay || due > 0) relevant = true;
    if (due > 0) done = false;
  }
  return { relevant, done: relevant && done };
}

export function useCircleDaily({ user, myCircleIds, joinedPlans, memberships, memoryQueue, dayStartHour, sabbathEnabled, sabbathDay }: CircleDailyDeps) {
  const [circleDaily, setCircleDaily] = useState<Record<string, DailyState>>({});
  // circleId -> whether I've turned sharing on there (from my own doc).
  const [mySharing, setMySharing] = useState<Record<string, boolean>>({});
  const lastWritten = useRef<Record<string, string>>({});

  useEffect(() => {
    if (!user) {
      setCircleDaily({});
      setMySharing({});
      lastWritten.current = {};
    }
  }, [user?.uid]);

  const circleKey = [...myCircleIds].sort().join(',');
  useEffect(() => {
    const me = auth.currentUser;
    if (!me || !user || myCircleIds.length === 0) return;
    let cancelled = false;
    Promise.all(
      myCircleIds.map((id) =>
        getDoc(doc(db, 'circles', id, 'dailyProgress', me.uid))
          .then((s) => [id, s.exists() && s.data().shares === true] as const)
          .catch(() => [id, false] as const)
      )
    ).then((pairs) => {
      if (!cancelled) setMySharing(Object.fromEntries(pairs));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [circleKey, user?.uid]);

  const loadCircleDaily = async (circleId: string) => {
    if (!auth.currentUser) return;
    setCircleDaily((prev) => ({ ...prev, [circleId]: { entries: prev[circleId]?.entries ?? [], loading: !prev[circleId] } }));
    try {
      const snap = await getDocs(collection(db, 'circles', circleId, 'dailyProgress'));
      const entries = snap.docs.map((d) => {
        const data = d.data();
        return { uid: d.id, shares: data.shares === true, day: String(data.day ?? ''), done: data.done === true } as CircleDailyEntry;
      });
      setCircleDaily((prev) => ({ ...prev, [circleId]: { entries, loading: false } }));
      const mine = entries.find((e) => e.uid === auth.currentUser?.uid);
      setMySharing((prev) => ({ ...prev, [circleId]: !!mine?.shares }));
    } catch (err) {
      setCircleDaily((prev) => ({ ...prev, [circleId]: { entries: prev[circleId]?.entries ?? [], loading: false } }));
      handleFirestoreError(err, OperationType.LIST, `circles/${circleId}/dailyProgress`);
    }
  };

  const today = () => getLogicalDate(dayStartHour);
  const isSabbathToday = () => sabbathEnabled && DAY_ABBREVS[today().getDay()] === sabbathDay;

  const writeMine = async (circleId: string, shares: boolean) => {
    const me = auth.currentUser;
    if (!me) return;
    const t = today();
    const status = shares ? circleDayStatus(circleId, joinedPlans, memberships, memoryQueue, t) : { relevant: false, done: false };
    const day = localDayKey(t);
    const done = status.relevant && status.done && !isSabbathToday();
    await setDoc(doc(db, 'circles', circleId, 'dailyProgress', me.uid), {
      uid: me.uid,
      shares,
      day,
      done,
      updatedAt: new Date().toISOString(),
    });
    lastWritten.current[circleId] = `${shares}:${day}:${done}`;
    setCircleDaily((prev) => {
      const cur = prev[circleId]?.entries ?? [];
      const entry: CircleDailyEntry = { uid: me.uid, shares, day, done };
      return { ...prev, [circleId]: { entries: [...cur.filter((e) => e.uid !== me.uid), entry], loading: false } };
    });
  };

  /** The switch on a circle's page. */
  const setProgressSharing = async (circleId: string, on: boolean) => {
    setMySharing((prev) => ({ ...prev, [circleId]: on }));
    try {
      await writeMine(circleId, on);
    } catch (err) {
      setMySharing((prev) => ({ ...prev, [circleId]: !on }));
      handleFirestoreError(err, OperationType.WRITE, `circles/${circleId}/dailyProgress`);
    }
  };

  // Keep my doc in step with the queue: when I start today's verses, the
  // circle's strip turns over. Debounced, and skipped while the queue may
  // still be loading (an empty queue would read as "nothing started").
  useEffect(() => {
    if (!user || memoryQueue.length === 0) return;
    const ids = Object.keys(mySharing).filter((id) => mySharing[id]);
    if (ids.length === 0) return;
    const timer = setTimeout(() => {
      const t = today();
      const day = localDayKey(t);
      for (const id of ids) {
        const status = circleDayStatus(id, joinedPlans, memberships, memoryQueue, t);
        if (!status.relevant) continue;
        const done = status.done && !isSabbathToday();
        if (lastWritten.current[id] === `true:${day}:${done}`) continue;
        writeMine(id, true).catch((err) => handleFirestoreError(err, OperationType.WRITE, `circles/${id}/dailyProgress`));
      }
    }, 1500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memoryQueue, joinedPlans, memberships, mySharing, user?.uid]);

  /** Demo mode only: what a circle's load would have found. */
  const seedCircleDaily = (circleId: string, entries: CircleDailyEntry[]) => {
    setCircleDaily((prev) => ({ ...prev, [circleId]: { entries, loading: false } }));
    const mine = entries.find((e) => e.uid === 'demo');
    if (mine) setMySharing((prev) => ({ ...prev, [circleId]: mine.shares }));
  };

  return { circleDaily, mySharing, loadCircleDaily, setProgressSharing, seedCircleDaily };
}
