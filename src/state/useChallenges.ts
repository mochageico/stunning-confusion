import { useEffect, useRef, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import type {
  Challenge,
  DMThread,
  Friend,
  QueueItem,
  VerseState,
} from '../types';
import { countRangeProgress, VerseRange } from '../lib/verseRange';

// ============================================================================
// CHALLENGES
// ----------------------------------------------------------------------------
// 1:1 races in a DM, plus keeping my
// progress in step with my queue. Split out of useAppState (see
// .claude/file-split-plan.md).
// ============================================================================

interface ChallengesDeps {
  user: { uid: string; displayName?: string | null; photoURL?: string | null } | null;
  friends: Friend[];
  activeDMThread: DMThread | null;
  selectedTranslationId: string;
  findSharedCircleIds: (otherUid: string) => Promise<string[]>;
  fetchRangeVerses: (translationId: string, range: VerseRange) => Promise<{ verses: VerseState[]; totalVerses: number }>;
  addVersesToQueue: (versesToAdd: VerseState[], translationId: string) => void;
  /** The queue as of right now (memoryQueueRef), not the render-time copy. */
  getQueue: () => QueueItem[];
  triggerToast: (message: string) => void;
}

export function useChallenges({
  user,
  friends,
  activeDMThread,
  selectedTranslationId,
  findSharedCircleIds,
  fetchRangeVerses,
  addVersesToQueue,
  getQueue,
  triggerToast,
}: ChallengesDeps) {
  // 1:1 "race this passage" challenges -- see Challenge in types.ts.
  // activeChallenges is scoped to whichever DM thread is currently open
  // (live, like activeDMMessages); myChallengeBadges is a lighter
  // always-on listener (pending/active challenges across ALL my threads)
  // purely so MessagesScreen's inbox rows can show a 🏆 badge without
  // opening each thread.
  const [activeChallenges, setActiveChallenges] = useState<Challenge[]>([]);
  const [loadingActiveChallenges, setLoadingActiveChallenges] = useState(false);
  const [myChallengeBadges, setMyChallengeBadges] = useState<Challenge[]>([]);

  // ==========================================
  // 1:1 CHALLENGES -- see Challenge in types.ts. Verses are added to each
  // side's own queue the moment that side is present for it: the sender at
  // creation, the recipient at acceptance (declined/never-accepted
  // challenges never touch the recipient's queue at all).
  // ==========================================

  const sendChallenge = async (
    toUid: string,
    toName: string,
    toAvatarUrl: string,
    range: { book: string; startChapter: number; endChapter: number; startVerse?: number; endVerse?: number }
  ) => {
    if (!auth.currentUser || toUid === auth.currentUser.uid) return;
    const myUid = auth.currentUser.uid;
    // Same deterministic id DM threads themselves use (see openDMThread) --
    // computed directly rather than requiring a thread to already be open,
    // so this works from MemberProfileScreen too. The DM thread doc doesn't
    // need to exist yet; opening it later (openDMThread) lands on the same
    // id and the pending card just shows up.
    const dmThreadId = [myUid, toUid].sort().join('_');
    try {
      // Same gate as opening a DM: friends, or a circle both are really in.
      // Checked before fetching verses so a refused challenge doesn't quietly
      // add the range to my own queue.
      const isFriend = friends.some((f) => f.uid === toUid);
      const sharedCircleIds = isFriend ? [] : await findSharedCircleIds(toUid);
      if (!isFriend && sharedCircleIds.length === 0) {
        triggerToast('You can only challenge friends or people who share a community with you.');
        return;
      }
      const { verses, totalVerses } = await fetchRangeVerses(selectedTranslationId, range);
      if (totalVerses === 0) {
        triggerToast("Couldn't find any verses in that range.");
        return;
      }
      const nowISO = new Date().toISOString();
      const data: any = {
        fromUid: myUid,
        fromName: auth.currentUser.displayName || 'Anonymous Disciple',
        fromAvatarUrl: '',
        toUid,
        toName,
        toAvatarUrl,
        participantUids: [myUid, toUid].sort(),
        dmThreadId,
        book: range.book,
        startChapter: range.startChapter,
        endChapter: range.endChapter,
        totalVerses,
        status: 'pending',
        createdAt: nowISO,
        fromProgress: 0,
        toProgress: 0,
        // The rules can only check ONE circle (no loops), so record the one
        // we verified. Friends need none.
        ...(sharedCircleIds.length > 0 ? { viaCircleId: sharedCircleIds[0] } : {}),
      };
      if (range.startVerse != null) data.startVerse = range.startVerse;
      if (range.endVerse != null) data.endVerse = range.endVerse;
      await addDoc(collection(db, 'challenges'), data);
      addVersesToQueue(verses, selectedTranslationId);
      triggerToast(`Challenge sent to ${toName}.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'challenges');
      triggerToast("Couldn't send that challenge. Try again.");
    }
  };

  const acceptChallenge = async (challenge: Challenge) => {
    if (!auth.currentUser || auth.currentUser.uid !== challenge.toUid) return;
    try {
      const { verses } = await fetchRangeVerses(selectedTranslationId, challenge);
      await updateDoc(doc(db, 'challenges', challenge.id), {
        status: 'active',
        respondedAt: new Date().toISOString(),
      });
      addVersesToQueue(verses, selectedTranslationId);
      triggerToast('Challenge accepted. The race is on.');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `challenges/${challenge.id}`);
    }
  };

  const declineChallenge = async (challenge: Challenge) => {
    try {
      await updateDoc(doc(db, 'challenges', challenge.id), {
        status: 'declined',
        respondedAt: new Date().toISOString(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `challenges/${challenge.id}`);
    }
  };

  // Hard-deletes the challenge doc for BOTH sides, at any status -- either
  // participant can do it (see firestore.rules). Verses already pulled into
  // either side's memoryQueue are deliberately left alone: they're real
  // memorization progress that happens to have been started by a challenge,
  // not challenge-owned data.
  const deleteChallenge = async (challenge: Challenge) => {
    const myUid = auth.currentUser?.uid;
    if (!myUid || (challenge.fromUid !== myUid && challenge.toUid !== myUid)) return;
    try {
      await deleteDoc(doc(db, 'challenges', challenge.id));
      delete challengeProgressSyncRef.current[`c_${challenge.id}`];
      triggerToast('Challenge deleted. Your verses stay on your list.');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `challenges/${challenge.id}`);
      triggerToast("Couldn't delete that challenge. Try again.");
    }
  };

  // Live challenges for whichever DM thread is currently open (usually 0 or 1,
  // but not constrained to that -- a past declined/completed challenge stays
  // queryable here too, so the thread can show history if ever needed).
  useEffect(() => {
    if (!activeDMThread) {
      setActiveChallenges([]);
      return;
    }
    setLoadingActiveChallenges(true);
    const q = query(collection(db, 'challenges'), where('dmThreadId', '==', activeDMThread.id));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setActiveChallenges(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Challenge));
        setLoadingActiveChallenges(false);
      },
      (err) => {
        console.error('Failed to load challenges:', err);
        setLoadingActiveChallenges(false);
      }
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDMThread?.id]);

  // Lightweight always-on listener (not tied to any open thread) purely so
  // MessagesScreen's inbox rows can show a 🏆 badge without opening each
  // thread individually.
  useEffect(() => {
    if (!user) {
      setMyChallengeBadges([]);
      return;
    }
    const q = query(
      collection(db, 'challenges'),
      where('participantUids', 'array-contains', user.uid),
      where('status', 'in', ['pending', 'active'])
    );
    const unsub = onSnapshot(
      q,
      (snap) => setMyChallengeBadges(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Challenge)),
      (err) => console.error('Failed to load challenge badges:', err)
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Ref cache of "the progress value I last actually wrote" per challenge,
  // keyed so this can be called cheaply from every place a verse might leave
  // 'queued' status (promoteToLearning, handleReviewCompleted,
  // overrideVerseMemoryStatus) without re-writing when nothing changed --
  // countRangeProgress only changes when a verse is learned (or reset), so
  // most calls here are no-ops by design, not just an optimization.
  const challengeProgressSyncRef = useRef<Record<string, number>>({});

  // Latest lists for syncChallengeProgress, which review handlers can call
  // from a stale render's closure. 1:1 challenges come from the always-on
  // listener (every thread), not activeChallenges, which only holds the
  // thread that happens to be open.
  const latestRef = useRef({ challenges: myChallengeBadges });
  latestRef.current = { challenges: myChallengeBadges };

  const syncChallengeProgress = () => {
    if (!auth.currentUser) return;
    const myUid = auth.currentUser.uid;
    const freshQueue = getQueue();

    latestRef.current.challenges.forEach((challenge) => {
      if (challenge.status !== 'active') return;
      if (challenge.fromUid !== myUid && challenge.toUid !== myUid) return;
      const cacheKey = `c_${challenge.id}`;
      const newProgress = countRangeProgress(freshQueue, challenge);
      if (challengeProgressSyncRef.current[cacheKey] === newProgress) return;
      challengeProgressSyncRef.current[cacheKey] = newProgress;
      const isFrom = challenge.fromUid === myUid;
      const myOldProgress = isFrom ? challenge.fromProgress : challenge.toProgress;
      if (newProgress === myOldProgress) return;
      const otherProgress = isFrom ? challenge.toProgress : challenge.fromProgress;
      const bothDone = newProgress >= challenge.totalVerses && otherProgress >= challenge.totalVerses;
      const patch: any = isFrom ? { fromProgress: newProgress } : { toProgress: newProgress };
      if (bothDone) patch.status = 'completed';
      updateDoc(doc(db, 'challenges', challenge.id), patch).catch((err) => {
        // Forget the cached value so the next sync tries again.
        delete challengeProgressSyncRef.current[cacheKey];
        handleFirestoreError(err, OperationType.UPDATE, `challenges/${challenge.id}`);
      });
    });

  };

  // Catch up whenever the challenge lists load or change, so a verse learned
  // while a chat or circle was closed (or offline) still reaches the card.
  // Skipped while the queue is empty: it may just not have loaded yet, and
  // that would write a progress of 0.
  useEffect(() => {
    if (getQueue().length === 0) return;
    syncChallengeProgress();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myChallengeBadges]);

  return {
    activeChallenges,
    loadingActiveChallenges,
    myChallengeBadges,
    sendChallenge,
    acceptChallenge,
    declineChallenge,
    deleteChallenge,
    syncChallengeProgress,
  };
}
