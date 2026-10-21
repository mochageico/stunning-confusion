import { useState } from 'react';
import { collection, deleteDoc, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';

import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import type { GroupPlan, GroupPlanMembership, QueueItem } from '../types';
import { ALL_BIBLE_BOOKS, DEFAULT_TRANSLATION_ID, getBookByName } from '../data';
import { buildVerseId, JOINED_GROUP_PLANS_FIELD, normalizeGroupPlan } from '../lib/appData';
import { fetchChapterText } from './useScripture';

// ============================================================================
// GROUP PLANS
// ----------------------------------------------------------------------------
// A circle's curated list of verses plus a target pace (not a retention
// method -- see the note on Review Settings sharing in usePlanSettings). The open
// circle's plans, the plans I've joined, and adding a plan's verses to my
// queue. Split out of useAppState (see .claude/file-split-plan.md).
// ============================================================================

interface GroupPlansDeps {
  user: { uid: string; displayName?: string | null } | null;
  /** The queue as of right now (memoryQueueRef), not the render-time copy. */
  getQueue: () => QueueItem[];
  updateMemoryQueue: (updater: (prev: QueueItem[]) => QueueItem[]) => void;
  removeQueueItems: (verseIds: string[]) => void;
  triggerToast: (message: string) => void;
}

export function useGroupPlans({ user, getQueue, updateMemoryQueue, removeQueueItems, triggerToast }: GroupPlansDeps) {
  // Every GroupPlan this member has joined (possibly more than one, each with
  // its own priority setting -- see src/lib/groupPlanScheduler.ts) plus the
  // resolved GroupPlan docs themselves (versesPerWeek, verseIds, etc.), kept
  // in sync so the scheduler always has real, current data to work from.
  const [joinedGroupPlanMemberships, setJoinedGroupPlanMemberships] = useState<GroupPlanMembership[]>([]);
  const [joinedGroupPlanDetails, setJoinedGroupPlanDetails] = useState<GroupPlan[]>([]);
  const [viewingGroupPlan, setViewingGroupPlan] = useState<GroupPlan | null>(null);
  const [activeCircleGroupPlans, setActiveCircleGroupPlans] = useState<GroupPlan[]>([]);

  // Creation only asks for a title + description -- no book/chapter/speed
  // up front. Per explicit user direction: real people rarely memorize
  // whole books together, so the actual verse queue is built incrementally
  // from the plan's own landing page (addVersesToGroupPlan below), and its
  // pace (versesPerWeek) is set/edited there too, not at creation time.
  const createGroupPlan = async (circleId: string, input: { name: string; description: string }) => {
    if (!auth.currentUser) return;
    const trimmedName = input.name.trim();
    if (!trimmedName) {
      triggerToast('Give the plan a name first.');
      return;
    }
    const planRef = doc(collection(db, 'circles', circleId, 'groupPlans'));
    const now = new Date().toISOString();
    const newPlan: GroupPlan = {
      planId: planRef.id,
      circleId,
      name: trimmedName,
      description: input.description.trim(),
      managerId: auth.currentUser.uid,
      managerName: user?.displayName || 'Anonymous Disciple',
      versesPerWeek: 3,
      verseIds: [],
      createdAt: now,
      updatedAt: now,
    };

    try {
      await setDoc(planRef, newPlan);
      setActiveCircleGroupPlans((prev) => [...prev, newPlan]);
      triggerToast(`Created "${trimmedName}". Add verses and set a pace from its page.`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `circles/${circleId}/groupPlans/${planRef.id}`);
    }
  };

  const updateGroupPlan = async (
    circleId: string,
    planId: string,
    fields: Partial<Pick<GroupPlan, 'name' | 'description' | 'versesPerWeek'>>
  ) => {
    try {
      const updatedAt = new Date().toISOString();
      await updateDoc(doc(db, 'circles', circleId, 'groupPlans', planId), { ...fields, updatedAt });
      const apply = (p: GroupPlan) => (p.planId === planId ? { ...p, ...fields, updatedAt } : p);
      setActiveCircleGroupPlans((prev) => prev.map(apply));
      setJoinedGroupPlanDetails((prev) => prev.map(apply));
      setViewingGroupPlan((prev) => (prev && prev.planId === planId ? apply(prev) : prev));
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `circles/${circleId}/groupPlans/${planId}`);
    }
  };

  // Manager builds a plan's verse queue incrementally, a handful of verses
  // at a time, from real scripture text -- rather than committing a whole
  // book/chapter up front like the old "Deploy New Circle Plan" form did.
  const addVersesToGroupPlan = async (
    circleId: string,
    planId: string,
    book: string,
    chapter: number,
    startVerse: number,
    endVerse: number
  ) => {
    const bookId = getBookByName(book)?.id;
    if (!bookId) {
      triggerToast(`Unrecognized book: ${book}`);
      return;
    }
    const chapterData = await fetchChapterText(DEFAULT_TRANSLATION_ID, bookId, chapter);
    if (!chapterData) {
      triggerToast(`Couldn't find ${book} ${chapter} in the scripture library yet.`);
      return;
    }
    const lo = Math.min(startVerse, endVerse);
    const hi = Math.max(startVerse, endVerse);
    const newVerseIds: string[] = [];
    for (let v = lo; v <= hi; v++) {
      if (chapterData.verses[String(v)]) newVerseIds.push(`${bookId}_${chapter}_${v}`);
    }
    if (newVerseIds.length === 0) {
      triggerToast(`No verses found in ${book} ${chapter}:${lo}-${hi}.`);
      return;
    }

    const existingPlan = activeCircleGroupPlans.find((p) => p.planId === planId);
    const mergedVerseIds = Array.from(new Set([...(existingPlan?.verseIds || []), ...newVerseIds]));

    try {
      const updatedAt = new Date().toISOString();
      await updateDoc(doc(db, 'circles', circleId, 'groupPlans', planId), { verseIds: mergedVerseIds, updatedAt });
      const apply = (p: GroupPlan) => (p.planId === planId ? { ...p, verseIds: mergedVerseIds, updatedAt } : p);
      setActiveCircleGroupPlans((prev) => prev.map(apply));
      setJoinedGroupPlanDetails((prev) => prev.map(apply));
      setViewingGroupPlan((prev) => (prev && prev.planId === planId ? apply(prev) : prev));

      // Self-heal the manager's OWN queue immediately if they're also a
      // member -- other members' queues pick up the new verses the next
      // time their own session loads (see loadUserData), since a client
      // can't write into another user's private memoryQueue.
      if (joinedGroupPlanMemberships.some((m) => m.planId === planId)) {
        await addGroupPlanVersesToOwnQueue(planId, newVerseIds);
      }

      triggerToast(`Added ${newVerseIds.length} verse${newVerseIds.length === 1 ? '' : 's'} to the plan.`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `circles/${circleId}/groupPlans/${planId}`);
    }
  };

  const deleteGroupPlan = async (circleId: string, planId: string) => {
    try {
      await deleteDoc(doc(db, 'circles', circleId, 'groupPlans', planId));
      setActiveCircleGroupPlans((prev) => prev.filter((p) => p.planId !== planId));
      setJoinedGroupPlanDetails((prev) => prev.filter((p) => p.planId !== planId));
      setViewingGroupPlan((prev) => (prev && prev.planId === planId ? null : prev));
      triggerToast('Plan deleted.');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `circles/${circleId}/groupPlans/${planId}`);
    }
  };

  // Fetches real verse text for whichever of `verseIds` aren't already in
  // the member's own queue and appends them as 'queued', tagged to this
  // plan -- shared by joinGroupPlan (the plan's full current range) and
  // addVersesToGroupPlan's self-heal path (just the newly-added verses).
  const addGroupPlanVersesToOwnQueue = async (planId: string, verseIds: string[]) => {
    // GroupPlan.verseIds are translation-less ("GEN_1_3") -- group plans
    // don't have per-member translation choice yet, always resolved as
    // DEFAULT_TRANSLATION_ID, so "already in my queue" means the
    // DEFAULT_TRANSLATION_ID-prefixed form of this reference already exists
    // (QueueItem.verseId is translation-prefixed -- see buildVerseId).
    const currentQueueIds = new Set(getQueue().map((item) => item.verseId));
    const missingRefs = verseIds
      .map((vId) => {
        const [bookId, chapterStr, verseStr] = vId.split('_');
        return { bookId, chapter: parseInt(chapterStr, 10), verseNumber: parseInt(verseStr, 10) };
      })
      .filter((ref) => !currentQueueIds.has(buildVerseId(DEFAULT_TRANSLATION_ID, ref.bookId, ref.chapter, ref.verseNumber)));
    if (missingRefs.length === 0) return;

    // Group by book+chapter so each real chapter is only fetched once,
    // regardless of how many of its verses are in this plan's range.
    const byChapter = new Map<string, { bookId: string; chapter: number; verseNumbers: number[] }>();
    missingRefs.forEach(({ bookId, chapter, verseNumber }) => {
      const key = `${bookId}_${chapter}`;
      if (!byChapter.has(key)) byChapter.set(key, { bookId, chapter, verseNumbers: [] });
      byChapter.get(key)!.verseNumbers.push(verseNumber);
    });

    const newItems: QueueItem[] = [];
    for (const { bookId, chapter, verseNumbers } of byChapter.values()) {
      const bookMeta = ALL_BIBLE_BOOKS.find((b) => b.id === bookId);
      const chapterData = await fetchChapterText(DEFAULT_TRANSLATION_ID, bookId, chapter);
      if (!bookMeta || !chapterData) continue;
      verseNumbers.forEach((verseNumber) => {
        const text = chapterData.verses[String(verseNumber)];
        if (!text) return;
        newItems.push({
          verseId: buildVerseId(DEFAULT_TRANSLATION_ID, bookId, chapter, verseNumber),
          translationId: DEFAULT_TRANSLATION_ID,
          book: bookMeta.name,
          chapter,
          verseNumber,
          text,
          orderIndex: getQueue().length + newItems.length,
          status: 'queued',
          origin: 'group',
          originPlanId: planId,
          retentionPhase: 'none',
          dateStarted: null,
          lastReviewDate: null,
          nextReviewDueDate: null,
          currentStreakCount: 0,
          totalSuccessfulReviews: 0,
          gracePeriodUsedToday: false,
        });
      });
    }

    if (newItems.length > 0) {
      // No manual Firestore batch write here — the memoryQueue auto-sync
      // effect picks up this queue update and persists it (including
      // deletion-diffing), debounced.
      updateMemoryQueue((prev) => [...prev, ...newItems]);
    }
  };

  const persistJoinedGroupPlans = async (memberships: GroupPlanMembership[]) => {
    if (!auth.currentUser) return;
    try {
      const planRef = doc(db, 'memoryPlans', auth.currentUser.uid);
      // merge: true — this doc also holds savedPlans and other top-level
      // plan fields; a plain setDoc here would silently erase them.
      //
      // The constant, not a literal: this key still carries the pre-rename
      // wording on every existing document. See its definition.
      await setDoc(planRef, { [JOINED_GROUP_PLANS_FIELD]: memberships, updatedAt: new Date() }, { merge: true });
    } catch (err) {
      console.error('Failed to persist joined group plans:', err);
    }
  };

  const joinGroupPlan = async (plan: GroupPlan, priority: GroupPlanMembership['priority'] = 'group') => {
    try {
      await addGroupPlanVersesToOwnQueue(plan.planId, plan.verseIds);

      const membership: GroupPlanMembership = {
        planId: plan.planId,
        circleId: plan.circleId,
        priority,
        joinedAt: new Date().toISOString(),
      };
      const updatedMemberships = [...joinedGroupPlanMemberships.filter((m) => m.planId !== plan.planId), membership];
      setJoinedGroupPlanMemberships(updatedMemberships);
      setJoinedGroupPlanDetails((prev) => [...prev.filter((p) => p.planId !== plan.planId), plan]);
      await persistJoinedGroupPlans(updatedMemberships);

      triggerToast(`Joined "${plan.name}". Its verses are in your queue.`);
    } catch (err) {
      console.error('Error joining group plan:', err);
      triggerToast("Couldn't join this plan. Please try again.");
    }
  };

  // Only strips verses that are still 'queued' (never actually started) --
  // anything already being learned/reviewed/retained is left alone, since
  // leaving a plan shouldn't erase real progress already made on it.
  const leaveGroupPlan = async (planId: string) => {
    const updatedMemberships = joinedGroupPlanMemberships.filter((m) => m.planId !== planId);
    setJoinedGroupPlanMemberships(updatedMemberships);
    setJoinedGroupPlanDetails((prev) => prev.filter((p) => p.planId !== planId));
    removeQueueItems(
      getQueue()
        .filter((item) => item.originPlanId === planId && item.status === 'queued')
        .map((item) => item.verseId)
    );
    await persistJoinedGroupPlans(updatedMemberships);
    triggerToast('You left the plan.');
  };

  const setGroupPlanPriority = async (planId: string, priority: GroupPlanMembership['priority']) => {
    const updatedMemberships = joinedGroupPlanMemberships.map((m) => (m.planId === planId ? { ...m, priority } : m));
    setJoinedGroupPlanMemberships(updatedMemberships);
    await persistJoinedGroupPlans(updatedMemberships);
  };

  // Leaving/disbanding an entire circle should also drop membership in
  // whatever Group Plans belonged to it -- mirrors the old single-plan
  // code's setActiveGroupPlan(null) on the same actions, just generalized
  // to however many plans of that circle this member had joined.
  const clearGroupPlanMembershipsForCircle = (circleId: string) => {
    const updatedMemberships = joinedGroupPlanMemberships.filter((m) => m.circleId !== circleId);
    setJoinedGroupPlanMemberships(updatedMemberships);
    setJoinedGroupPlanDetails((prev) => prev.filter((p) => p.circleId !== circleId));
    persistJoinedGroupPlans(updatedMemberships);
  };

  /** The open circle's plans, from loadActiveCircleData. */
  const applyCircleGroupPlans = (plans: GroupPlan[]) => {
    setActiveCircleGroupPlans(plans);
  };

  // Joined Group Plans: resolve membership records into the real GroupPlan
  // docs they point to. Called from loadUserData with the memberships saved
  // on memoryPlans/{uid}.
  const loadJoinedGroupPlans = async (memberships: GroupPlanMembership[]) => {
    setJoinedGroupPlanMemberships(memberships);
    if (memberships.length > 0) {
      try {
        const planDocs = await Promise.all(
          memberships.map((m) => getDoc(doc(db, 'circles', m.circleId, 'groupPlans', m.planId)))
        );
        const resolvedPlans = planDocs
          .filter((snap) => snap.exists())
          .map((snap) => normalizeGroupPlan(snap.id, snap.data()));
        setJoinedGroupPlanDetails(resolvedPlans);
      } catch (e) {
        console.error('Failed to resolve joined group plans:', e);
      }
    } else {
      setJoinedGroupPlanDetails([]);
    }
  };

  /** Clears every group plan on an auth transition. */
  const resetGroupPlans = () => {
    setActiveCircleGroupPlans([]);
    setJoinedGroupPlanMemberships([]);
    setJoinedGroupPlanDetails([]);
    setViewingGroupPlan(null);
  };

  return {
    joinedGroupPlanMemberships,
    joinedGroupPlanDetails,
    viewingGroupPlan,
    setViewingGroupPlan,
    activeCircleGroupPlans,
    applyCircleGroupPlans,
    loadJoinedGroupPlans,
    resetGroupPlans,
    createGroupPlan,
    updateGroupPlan,
    addVersesToGroupPlan,
    deleteGroupPlan,
    joinGroupPlan,
    leaveGroupPlan,
    setGroupPlanPriority,
    clearGroupPlanMembershipsForCircle,
  };
}
