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
  GroupChallenge,
  GroupChallengeMembership,
  GroupChallengeParticipant,
  QueueItem,
  VerseState,
} from '../types';
import { countRangeProgress, VerseRange } from '../lib/verseRange';

// ============================================================================
// CHALLENGES
// ----------------------------------------------------------------------------
// 1:1 races in a DM and group challenges inside a circle, plus keeping my
// progress on each in step with my queue. Split out of useAppState (see
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
  // purely so MessagesScreen's inbox rows can show a trophy badge without
  // opening each thread.
  const [activeChallenges, setActiveChallenges] = useState<Challenge[]>([]);
  const [loadingActiveChallenges, setLoadingActiveChallenges] = useState(false);
  const [myChallengeBadges, setMyChallengeBadges] = useState<Challenge[]>([]);

  // Group challenges hosted inside whichever Circle detail page is open --
  // see GroupChallenge/GroupChallengeParticipant in types.ts. Participants
  // for whichever single challenge card is expanded (leaderboard modal open)
  // are loaded separately, keyed by challenge id, so opening the circle
  // detail page itself doesn't fan out one listener per challenge.
  const [activeCircleChallenges, setActiveCircleChallenges] = useState<GroupChallenge[]>([]);
  const [loadingActiveCircleChallenges, setLoadingActiveCircleChallenges] = useState(false);
  const [openChallengeLeaderboardId, setOpenChallengeLeaderboardId] = useState<string | null>(null);
  const [openChallengeLeaderboard, setOpenChallengeLeaderboard] = useState<GroupChallengeParticipant[]>([]);
  const [loadingChallengeLeaderboard, setLoadingChallengeLeaderboard] = useState(false);
  // My own membership records across ALL group challenges I've joined
  // (not just whichever circle is currently open) -- denormalized onto
  // memoryPlans/{uid}.joinedGroupChallenges, same pattern as
  // joinedGroupPlanMemberships, needed so progress-sync after a review can
  // find "am I in a challenge for this verse" without opening every circle.
  const [joinedGroupChallenges, setJoinedGroupChallenges] = useState<GroupChallengeMembership[]>([]);

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
      triggerToast("Couldn't send that challenge -- please try again.");
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
      triggerToast('Challenge deleted. Your verses stay in your queue.');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `challenges/${challenge.id}`);
      triggerToast("Couldn't delete that challenge -- please try again.");
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
  // MessagesScreen's inbox rows can show a trophy badge without opening each
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

  // ==========================================
  // GROUP CHALLENGES -- see GroupChallenge/GroupChallengeParticipant in
  // types.ts. Unlike GroupPlan (leader-curated, verses trickle in weekly),
  // any member can create one and the whole range front-loads into the
  // joiner's queue immediately -- the "race" is who finishes reviewing it
  // first, not a paced feed.
  // ==========================================

  const joinGroupChallenge = async (challenge: GroupChallenge) => {
    if (!auth.currentUser) return;
    const myUid = auth.currentUser.uid;
    if (joinedGroupChallenges.some((m) => m.challengeId === challenge.id)) return;
    try {
      const { verses } = await fetchRangeVerses(selectedTranslationId, challenge);
      await setDoc(doc(db, 'circles', challenge.circleId, 'challenges', challenge.id, 'participants', myUid), {
        uid: myUid,
        name: user?.displayName || 'Anonymous Disciple',
        avatarUrl: user?.photoURL || '',
        progress: 0,
        joinedAt: new Date().toISOString(),
      });
      addVersesToQueue(verses, selectedTranslationId);
      const membership: GroupChallengeMembership = {
        circleId: challenge.circleId,
        challengeId: challenge.id,
        book: challenge.book,
        startChapter: challenge.startChapter,
        endChapter: challenge.endChapter,
        startVerse: challenge.startVerse,
        endVerse: challenge.endVerse,
        totalVerses: challenge.totalVerses,
        joinedAt: new Date().toISOString(),
      };
      const updated = [...joinedGroupChallenges.filter((m) => m.challengeId !== challenge.id), membership];
      setJoinedGroupChallenges(updated);
      await persistJoinedGroupChallenges(updated);
      triggerToast(`Joined "${challenge.title}". Its verses are in your queue.`);
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.WRITE,
        `circles/${challenge.circleId}/challenges/${challenge.id}/participants/${myUid}`
      );
    }
  };

  const createGroupChallenge = async (
    circleId: string,
    title: string,
    range: { book: string; startChapter: number; endChapter: number; startVerse?: number; endVerse?: number }
  ) => {
    if (!auth.currentUser) return;
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      triggerToast('Give the challenge a name first.');
      return;
    }
    try {
      const { totalVerses } = await fetchRangeVerses(selectedTranslationId, range);
      if (totalVerses === 0) {
        triggerToast("Couldn't find any verses in that range.");
        return;
      }
      const challengeRef = doc(collection(db, 'circles', circleId, 'challenges'));
      const data: any = {
        circleId,
        createdByUid: auth.currentUser.uid,
        createdByName: user?.displayName || 'Anonymous Disciple',
        title: trimmedTitle,
        book: range.book,
        startChapter: range.startChapter,
        endChapter: range.endChapter,
        totalVerses,
        status: 'active',
        createdAt: new Date().toISOString(),
      };
      if (range.startVerse != null) data.startVerse = range.startVerse;
      if (range.endVerse != null) data.endVerse = range.endVerse;
      await setDoc(challengeRef, data);
      const newChallenge = { id: challengeRef.id, ...data } as GroupChallenge;
      setActiveCircleChallenges((prev) => [...prev, newChallenge]);
      await joinGroupChallenge(newChallenge);
      triggerToast(`Created "${trimmedTitle}"!`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `circles/${circleId}/challenges`);
    }
  };

  const endGroupChallenge = async (challenge: GroupChallenge, status: 'completed' | 'cancelled' = 'completed') => {
    if (!auth.currentUser || auth.currentUser.uid !== challenge.createdByUid) return;
    try {
      await updateDoc(doc(db, 'circles', challenge.circleId, 'challenges', challenge.id), { status });
      setActiveCircleChallenges((prev) => prev.map((c) => (c.id === challenge.id ? { ...c, status } : c)));
      triggerToast(status === 'cancelled' ? 'Challenge cancelled.' : 'Challenge ended.');
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `circles/${challenge.circleId}/challenges/${challenge.id}`);
    }
  };

  // Creator-only, and genuinely destructive (unlike endGroupChallenge, which
  // just flips status and leaves the card on the page as a finished race).
  // Firestore has no cascading delete, so the participants subcollection is
  // cleared FIRST -- deleting only the parent doc would leave an
  // unreachable-but-permanent collection behind. Blast radius is bounded by
  // circle size (one participant doc per member who joined), so a single
  // batch is always sufficient here.
  const deleteGroupChallenge = async (challenge: GroupChallenge) => {
    const myUid = auth.currentUser?.uid;
    if (!myUid || myUid !== challenge.createdByUid) return;
    const challengePath = `circles/${challenge.circleId}/challenges/${challenge.id}`;
    try {
      const participantsSnap = await getDocs(
        collection(db, 'circles', challenge.circleId, 'challenges', challenge.id, 'participants')
      );
      const batch = writeBatch(db);
      participantsSnap.docs.forEach((d) => batch.delete(d.ref));
      batch.delete(doc(db, 'circles', challenge.circleId, 'challenges', challenge.id));
      await batch.commit();

      setActiveCircleChallenges((prev) => prev.filter((c) => c.id !== challenge.id));
      delete challengeProgressSyncRef.current[`g_${challenge.id}`];
      // Only MY own membership record can be cleaned up from here --
      // memoryPlans/{uid} is owner-write only, so other members keep a stale
      // membership until their own client notices the participant doc is
      // gone. syncChallengeProgress self-heals that (see the not-found
      // handling there).
      const remaining = joinedGroupChallenges.filter((m) => m.challengeId !== challenge.id);
      if (remaining.length !== joinedGroupChallenges.length) {
        setJoinedGroupChallenges(remaining);
        await persistJoinedGroupChallenges(remaining);
      }
      triggerToast('Challenge deleted. Everyone keeps the verses in their queue.');
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, challengePath);
      triggerToast("Couldn't delete that challenge -- please try again.");
    }
  };

  // Anyone who joined can drop out, creator included (a creator who leaves
  // still owns the challenge itself -- leaving and deleting are separate
  // actions on purpose). Verses already in the leaver's queue stay: they may
  // have real review progress on them by now.
  const leaveGroupChallenge = async (challenge: GroupChallenge) => {
    const myUid = auth.currentUser?.uid;
    if (!myUid) return;
    try {
      await deleteDoc(doc(db, 'circles', challenge.circleId, 'challenges', challenge.id, 'participants', myUid));
      delete challengeProgressSyncRef.current[`g_${challenge.id}`];
      const remaining = joinedGroupChallenges.filter((m) => m.challengeId !== challenge.id);
      setJoinedGroupChallenges(remaining);
      await persistJoinedGroupChallenges(remaining);
      triggerToast('Left the challenge. Your verses stay in your queue.');
    } catch (err) {
      handleFirestoreError(
        err,
        OperationType.DELETE,
        `circles/${challenge.circleId}/challenges/${challenge.id}/participants/${myUid}`
      );
    }
  };

  const openChallengeLeaderboardModal = async (challenge: GroupChallenge) => {
    setOpenChallengeLeaderboardId(challenge.id);
    setLoadingChallengeLeaderboard(true);
    try {
      const snap = await getDocs(collection(db, 'circles', challenge.circleId, 'challenges', challenge.id, 'participants'));
      setOpenChallengeLeaderboard(
        snap.docs.map((d) => d.data() as GroupChallengeParticipant).sort((a, b) => b.progress - a.progress)
      );
    } catch (err) {
      console.error('Failed to load challenge leaderboard:', err);
    } finally {
      setLoadingChallengeLeaderboard(false);
    }
  };

  const closeChallengeLeaderboard = () => {
    setOpenChallengeLeaderboardId(null);
    setOpenChallengeLeaderboard([]);
  };

  const persistJoinedGroupChallenges = async (memberships: GroupChallengeMembership[]) => {
    if (!auth.currentUser) return;
    try {
      const planRef = doc(db, 'memoryPlans', auth.currentUser.uid);
      await setDoc(planRef, { joinedGroupChallenges: memberships, updatedAt: new Date() }, { merge: true });
    } catch (err) {
      console.error('Failed to persist joined group challenges:', err);
    }
  };

  // Same reasoning as clearGroupPlanMembershipsForCircle in useAppState --
  // leaving/disbanding a circle should also drop membership in whatever
  // group challenges belonged to it.
  const clearGroupChallengeMembershipsForCircle = (circleId: string) => {
    const updatedMemberships = joinedGroupChallenges.filter((m) => m.circleId !== circleId);
    setJoinedGroupChallenges(updatedMemberships);
    persistJoinedGroupChallenges(updatedMemberships);
  };

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
  const latestRef = useRef({ challenges: myChallengeBadges, memberships: joinedGroupChallenges });
  latestRef.current = { challenges: myChallengeBadges, memberships: joinedGroupChallenges };

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

    latestRef.current.memberships.forEach((membership) => {
      const cacheKey = `g_${membership.challengeId}`;
      const newProgress = countRangeProgress(freshQueue, membership);
      if (challengeProgressSyncRef.current[cacheKey] === newProgress) return;
      challengeProgressSyncRef.current[cacheKey] = newProgress;
      updateDoc(doc(db, 'circles', membership.circleId, 'challenges', membership.challengeId, 'participants', myUid), {
        progress: newProgress,
      }).catch((err) => {
        delete challengeProgressSyncRef.current[cacheKey];
        // A 'not-found' here means the challenge (or at least my participant
        // doc) was deleted by its creator while I still hold a membership
        // record -- memoryPlans/{uid} is owner-write only, so they could
        // never have cleaned mine up for me. Prune it locally instead of
        // re-erroring on every future review.
        if ((err as { code?: string })?.code === 'not-found') {
          setJoinedGroupChallenges((prev) => {
            const pruned = prev.filter((m) => m.challengeId !== membership.challengeId);
            if (pruned.length !== prev.length) persistJoinedGroupChallenges(pruned);
            return pruned;
          });
          delete challengeProgressSyncRef.current[cacheKey];
          return;
        }
        handleFirestoreError(
          err,
          OperationType.UPDATE,
          `circles/${membership.circleId}/challenges/${membership.challengeId}/participants/${myUid}`
        );
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
  }, [myChallengeBadges, joinedGroupChallenges]);

  /** My group-challenge memberships from memoryPlans/{uid} (loadUserData). */
  const applyJoinedGroupChallenges = (memberships: GroupChallengeMembership[]) => {
    setJoinedGroupChallenges(memberships);
  };

  /** Clears every group challenge on an auth transition. */
  const resetGroupChallenges = () => {
    setActiveCircleChallenges([]);
    setJoinedGroupChallenges([]);
    setOpenChallengeLeaderboardId(null);
    setOpenChallengeLeaderboard([]);
  };

  return {
    activeChallenges,
    loadingActiveChallenges,
    myChallengeBadges,
    activeCircleChallenges,
    setActiveCircleChallenges,
    loadingActiveCircleChallenges,
    setLoadingActiveCircleChallenges,
    openChallengeLeaderboardId,
    openChallengeLeaderboard,
    loadingChallengeLeaderboard,
    joinedGroupChallenges,
    applyJoinedGroupChallenges,
    resetGroupChallenges,
    sendChallenge,
    acceptChallenge,
    declineChallenge,
    deleteChallenge,
    joinGroupChallenge,
    createGroupChallenge,
    endGroupChallenge,
    deleteGroupChallenge,
    leaveGroupChallenge,
    openChallengeLeaderboardModal,
    closeChallengeLeaderboard,
    clearGroupChallengeMembershipsForCircle,
    syncChallengeProgress,
  };
}
