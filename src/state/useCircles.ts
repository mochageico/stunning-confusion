import { Dispatch, SetStateAction, useState } from 'react';
import {
  arrayRemove,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import type { ActivityEvent, Circle, CircleMember, Friend, GroupChallenge, GroupPlan } from '../types';
import { normalizeGroupPlan } from '../lib/appData';
import { loadCircles, saveCircles } from '../lib/communityCopyStore';
import { removeSharesBy } from './useCircleTakeaways';

// ============================================================================
// SCRIPTURE CIRCLES
// ----------------------------------------------------------------------------
// My circles, public circles, the open circle's page, circle co-members, the
// activity feed, and the Community tab's own navigation state. Split out of
// useAppState (see .claude/file-split-plan.md).
// ============================================================================

interface CirclesDeps {
  user: { uid: string; displayName?: string | null; photoURL?: string | null } | null;
  friends: Friend[];
  /** The open circle's group plans (owned by the group-plan code). */
  applyCircleGroupPlans: (plans: GroupPlan[]) => void;
  setActiveCircleChallenges: Dispatch<SetStateAction<GroupChallenge[]>>;
  setLoadingActiveCircleChallenges: (loading: boolean) => void;
  triggerToast: (message: string) => void;
}

export function useCircles({
  user,
  friends,
  applyCircleGroupPlans,
  setActiveCircleChallenges,
  setLoadingActiveCircleChallenges,
  triggerToast,
}: CirclesDeps) {
  const [viewingGroupDetail, setViewingGroupDetail] = useState<boolean>(false);

  // Scripture Circles (real Firestore-backed community groups — see circles/{id}
  // in firestore.rules). myCircles/publicCircles/activeCircle* replace the old
  // local-only joinedGroups/groupMembersMap/groupAnnouncements/groupPlansList mocks.
  const [myCircles, setMyCircles] = useState<Circle[]>([]);
  const [loadingMyCircles, setLoadingMyCircles] = useState(false);
  const [publicCircles, setPublicCircles] = useState<Circle[]>([]);
  const [loadingPublicCircles, setLoadingPublicCircles] = useState(false);

  const [activeCircle, setActiveCircle] = useState<Circle | null>(null);
  const [activeCircleMembers, setActiveCircleMembers] = useState<CircleMember[]>([]);
  const [loadingActiveCircle, setLoadingActiveCircle] = useState(false);

  // "Friends" = real co-members across every circle the user belongs to
  // (deduped, self excluded) — there's no separate friend-request system.
  const [circleFriends, setCircleFriends] = useState<CircleMember[]>([]);

  // Real memorization-milestone activity feed (Community) — events from the
  // signed-in user and their real circleFriends.
  const [activityEvents, setActivityEvents] = useState<ActivityEvent[]>([]);
  const [loadingActivityEvents, setLoadingActivityEvents] = useState(false);

  // Community Sub-views and Custom Search/Join state
  const [communitySubView, setCommunitySubView] = useState<'home' | 'find' | 'create' | 'preview'>('home');
  const [activeGroupId, setActiveGroupId] = useState<string>('');

  // Read-only public preview of a circle (name/description/owner only) --
  // reachable by tapping a card on the Find Circles screen without joining
  // or loading the full members/study-plans dashboard.
  const [previewCircle, setPreviewCircle] = useState<Circle | null>(null);
  const openCirclePreview = (circle: Circle) => {
    setPreviewCircle(circle);
    setCommunitySubView('preview');
  };
  const closeCirclePreview = () => {
    setPreviewCircle(null);
    setCommunitySubView('find');
  };

  const [inviteCodeInput, setInviteCodeInput] = useState<string>('');

  // ==========================================
  // SCRIPTURE CIRCLES (real Firestore community groups)
  // ==========================================
  const generateInviteCode = () => Math.random().toString(36).slice(2, 8).toUpperCase();

  // generateInviteCode() alone had no collision check -- two circles could
  // theoretically land on the same code. Retries against the circleInvites
  // lookup (the same one joinCircleByCode reads) before accepting one; if
  // genuinely unlucky enough to collide every attempt, appends a timestamp
  // fragment rather than ever failing circle creation.
  const generateUniqueInviteCode = async (): Promise<string> => {
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateInviteCode();
      const snap = await getDoc(doc(db, 'circleInvites', code));
      if (!snap.exists()) return code;
    }
    return `${generateInviteCode()}${Date.now().toString(36).slice(-4).toUpperCase()}`;
  };

  const loadMyCircles = async () => {
    if (!auth.currentUser) {
      setMyCircles([]);
      return;
    }
    const uid = auth.currentUser.uid;
    setLoadingMyCircles(true);
    try {
      const profileSnap = await getDoc(doc(db, 'profiles', uid));
      const circleIds: string[] = profileSnap.exists() ? profileSnap.data().circleIds || [] : [];

      // Each circle loads on its own: one failed read used to throw out the
      // whole list, leaving My Circles empty for the rest of the session.
      // A failed circle is skipped ('error'), never pruned -- only a circle
      // confirmed gone (null) is.
      const results = await Promise.all(
        circleIds.map(async (id): Promise<Circle | null | 'error'> => {
          try {
            // Member doc first: once kicked from a PRIVATE circle, its doc is
            // no longer readable at all (permission-denied, not "missing").
            const memberSnap = await getDoc(doc(db, 'circles', id, 'members', uid));
            // Self-heal: a circle may have been disbanded, or this user kicked
            // from it, since circleIds was last written — neither of those can
            // update this user's OTHER-side data (disbanding can't touch every
            // member's profile; kicking can't either), so prune stale ids here.
            if (!memberSnap.exists()) return null;
            const circleSnap = await getDoc(doc(db, 'circles', id));
            if (!circleSnap.exists()) return null;
            return { id: circleSnap.id, ...circleSnap.data() } as Circle;
          } catch (err) {
            console.error(`Failed to load circle ${id}:`, err);
            return 'error';
          }
        })
      );

      const staleIds = circleIds.filter((id, idx) => results[idx] === null);
      if (staleIds.length > 0) {
        updateDoc(doc(db, 'profiles', uid), { circleIds: arrayRemove(...staleIds) }).catch((err) =>
          console.error('Failed to prune stale circleIds:', err)
        );
      }

      const validCircles = results.filter((c): c is Circle => c !== null && c !== 'error');
      setMyCircles(validCircles);
      loadCircleFriends(validCircles);
      // Kept for offline (lib/communityCopyStore), unless a circle failed to load.
      if (!results.includes('error')) saveCircles(uid, validCircles);
    } catch (err) {
      console.error('Failed to load my circles:', err);
      // No signal: the circles last seen on this device, read-only.
      const saved = await loadCircles(uid);
      if (saved && auth.currentUser?.uid === uid) setMyCircles((now) => (now.length > 0 ? now : saved));
    } finally {
      setLoadingMyCircles(false);
    }
  };

  // Gathers real co-members across every circle in myCircles (deduped, self
  // excluded) for ProfileScreen's "Friends" section. Call after myCircles is
  // populated/changes — e.g. right after loadMyCircles(), or on-demand from a
  // screen if circle membership might have changed since the last load.
  const loadCircleFriends = async (circles: Circle[]) => {
    if (circles.length === 0) {
      setCircleFriends([]);
      return;
    }
    try {
      const results = await Promise.all(circles.map((c) => getDocs(collection(db, 'circles', c.id, 'members'))));
      const byUid = new Map<string, CircleMember>();
      results.forEach((snap) => {
        snap.docs.forEach((d) => {
          const m = d.data() as CircleMember;
          if (m.uid !== auth.currentUser?.uid) byUid.set(m.uid, m);
        });
      });
      setCircleFriends(Array.from(byUid.values()));
    } catch (err) {
      console.error('Failed to load circle friends:', err);
    }
  };

  // Real activity feed: events from the signed-in user and their real
  // circleFriends. Re-run this (not just rely on the reactive effect in useAppState)
  // after actions that might change circleFriends but wouldn't otherwise
  // trigger it quickly enough, e.g. a manual refresh button.
  const loadActivityFeed = async () => {
    if (!auth.currentUser) {
      setActivityEvents([]);
      return;
    }
    const uids = Array.from(
      new Set([auth.currentUser.uid, ...circleFriends.map((f) => f.uid), ...friends.map((f) => f.uid)])
    ).slice(0, 30);
    setLoadingActivityEvents(true);
    try {
      const snap = await getDocs(
        query(collection(db, 'activityEvents'), where('uid', 'in', uids), orderBy('createdAt', 'desc'), limit(20))
      );
      const events: ActivityEvent[] = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          uid: data.uid,
          authorName: data.authorName,
          book: data.book,
          chapter: data.chapter,
          type: data.type,
          verse: data.verse,
          verseCount: data.verseCount,
          createdAtMs: data.createdAt?.toMillis ? data.createdAt.toMillis() : Date.now(),
        };
      });
      setActivityEvents(events);
    } catch (err) {
      console.error('Failed to load activity feed:', err);
    } finally {
      setLoadingActivityEvents(false);
    }
  };

  const loadPublicCircles = async () => {
    setLoadingPublicCircles(true);
    try {
      const q = query(collection(db, 'circles'), where('isPublic', '==', true));
      const snap = await getDocs(q);
      setPublicCircles(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Circle));
    } catch (err) {
      console.error('Failed to load public circles:', err);
    } finally {
      setLoadingPublicCircles(false);
    }
  };

  const loadActiveCircleData = async (circleId: string) => {
    setLoadingActiveCircle(true);
    setLoadingActiveCircleChallenges(true);
    try {
      const [circleSnap, membersSnap, plansSnap, challengesSnap] = await Promise.all([
        getDoc(doc(db, 'circles', circleId)),
        getDocs(collection(db, 'circles', circleId, 'members')),
        getDocs(collection(db, 'circles', circleId, 'groupPlans')),
        getDocs(collection(db, 'circles', circleId, 'challenges')),
      ]);
      const circle = circleSnap.exists() ? ({ id: circleSnap.id, ...circleSnap.data() } as Circle) : null;
      setActiveCircle(circle);
      setActiveCircleMembers(membersSnap.docs.map((d) => d.data() as CircleMember));
      // Circles made before join-by-code moved to circleInvites/{code} have
      // no lookup doc yet, so their code wouldn't work. Any member opening
      // the circle backfills it (firestore.rules only accepts the circle's
      // real code). Best effort -- never blocks loading the circle.
      const myUid = auth.currentUser?.uid;
      if (circle?.inviteCode && myUid && membersSnap.docs.some((d) => d.id === myUid)) {
        const inviteRef = doc(db, 'circleInvites', circle.inviteCode);
        getDoc(inviteRef)
          .then((s) => (s.exists() ? undefined : setDoc(inviteRef, { circleId: circle.id })))
          .catch((err) => console.error('Failed to backfill circle invite code:', err));
      }
      applyCircleGroupPlans(plansSnap.docs.map((d) => normalizeGroupPlan(d.id, d.data())));
      setActiveCircleChallenges(challengesSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as GroupChallenge));
    } catch (err) {
      console.error('Failed to load circle detail:', err);
    } finally {
      setLoadingActiveCircle(false);
      setLoadingActiveCircleChallenges(false);
    }
  };

  // Opens a circle's detail console and (re)loads its live data — the one
  // entry point screens should use instead of juggling several setters.
  const openCircle = (circleId: string) => {
    setActiveGroupId(circleId);
    setViewingGroupDetail(true);
    setCommunitySubView('home');
    loadActiveCircleData(circleId);
  };

  const createCircle = async (name: string, description: string, isPublic: boolean) => {
    if (!auth.currentUser) {
      triggerToast('Sign in to create a circle.');
      return;
    }
    const trimmedName = name.trim();
    if (!trimmedName) {
      triggerToast('Give the circle a name first.');
      return;
    }
    const uid = auth.currentUser.uid;
    const circleRef = doc(collection(db, 'circles'));
    const now = new Date().toISOString();
    const inviteCode = await generateUniqueInviteCode();
    const newCircle: Circle = {
      id: circleRef.id,
      name: trimmedName,
      description: description.trim() || 'A new Scripture Circle — pacing to be set by shared plans.',
      isPublic,
      ownerId: uid,
      ownerName: user?.displayName || 'Anonymous Disciple',
      inviteCode,
      createdAt: now,
      updatedAt: now,
    };
    const newMember: CircleMember = {
      uid,
      displayName: user?.displayName || 'Anonymous Disciple',
      avatarUrl: user?.photoURL || '',
      role: 'leader',
      joinedAt: now,
    };

    try {
      const batch = writeBatch(db);
      batch.set(circleRef, newCircle);
      batch.set(doc(db, 'circles', circleRef.id, 'members', uid), newMember);
      batch.set(doc(db, 'circleInvites', inviteCode), { circleId: circleRef.id });
      batch.set(doc(db, 'profiles', uid), { circleIds: arrayUnion(circleRef.id) }, { merge: true });
      await batch.commit();
      setMyCircles((prev) => [...prev, newCircle]);
      openCircle(circleRef.id);
      triggerToast(`Created "${trimmedName}".`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `circles/${circleRef.id}`);
    }
  };

  // inviteCode is required for a PRIVATE circle (firestore.rules checks it
  // against the circle's real code) and ignored for a public one.
  const joinCircle = async (circleId: string, circleName?: string, inviteCode?: string) => {
    if (!auth.currentUser) {
      triggerToast('Sign in to join a circle.');
      return;
    }
    const uid = auth.currentUser.uid;
    const memberRef = doc(db, 'circles', circleId, 'members', uid);
    try {
      const [existing, bannedSnap] = await Promise.all([
        getDoc(memberRef),
        getDoc(doc(db, 'circles', circleId, 'banned', uid)),
      ]);
      if (existing.exists()) {
        // The member doc is the real membership, but My Circles is built
        // from the profile's circleIds -- if that lost this id, the circle
        // was invisible with no way back short of recreating it. Put it back.
        if (!myCircles.some((c) => c.id === circleId)) {
          await setDoc(doc(db, 'profiles', uid), { circleIds: arrayUnion(circleId) }, { merge: true });
          await loadMyCircles();
        }
        openCircle(circleId);
        triggerToast("You're already in this circle.");
        return;
      }
      if (bannedSnap.exists()) {
        triggerToast("The circle's leader removed you, so you can't rejoin this one.");
        return;
      }

      const now = new Date().toISOString();
      const newMember: CircleMember = {
        uid,
        displayName: user?.displayName || 'Anonymous Disciple',
        avatarUrl: user?.photoURL || '',
        role: 'member',
        joinedAt: now,
        ...(inviteCode ? { inviteCode } : {}),
      };

      const batch = writeBatch(db);
      batch.set(memberRef, newMember);
      batch.set(doc(db, 'profiles', uid), { circleIds: arrayUnion(circleId) }, { merge: true });
      await batch.commit();

      // A private circle's doc only becomes readable once we're a member,
      // so the name comes from here when the caller couldn't know it.
      let name = circleName;
      if (!name) {
        const circleSnap = await getDoc(doc(db, 'circles', circleId)).catch(() => null);
        name = (circleSnap?.data() as Circle | undefined)?.name;
      }

      await loadMyCircles();
      openCircle(circleId);
      triggerToast(`Joined "${name || 'the circle'}".`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `circles/${circleId}/members/${uid}`);
    }
  };

  // Codes resolve through circleInvites/{code} -> circleId. Circles made
  // before that lookup existed get one the first time any member opens them
  // (see loadActiveCircleData); until then, a public one is still found by
  // the old query on the circle doc itself, which only works for public
  // circles now that private circle docs are members-only.
  const joinCircleByCode = async (codeInput: string) => {
    const code = codeInput.trim().toUpperCase();
    if (!code) {
      triggerToast('Enter an invite code first.');
      return;
    }
    try {
      let circleId: string | null = null;
      let circleName: string | undefined;
      const inviteSnap = /^[A-Z0-9]+$/.test(code) ? await getDoc(doc(db, 'circleInvites', code)) : null;
      if (inviteSnap?.exists()) {
        circleId = inviteSnap.data().circleId as string;
      } else {
        const snap = await getDocs(
          query(collection(db, 'circles'), where('isPublic', '==', true), where('inviteCode', '==', code), limit(1))
        );
        if (!snap.empty) {
          circleId = snap.docs[0].id;
          circleName = (snap.docs[0].data() as Circle).name;
        }
      }
      if (!circleId) {
        triggerToast(`No circle found for code "${code}".`);
        return;
      }
      await joinCircle(circleId, circleName, code);
      setInviteCodeInput('');
    } catch (err) {
      console.error('Failed to join by code:', err);
      triggerToast("Couldn't join with that code. Please try again.");
    }
  };

  const leaveCircle = async (circleId: string) => {
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;
    try {
      const batch = writeBatch(db);
      batch.delete(doc(db, 'circles', circleId, 'members', uid));
      batch.update(doc(db, 'profiles', uid), { circleIds: arrayRemove(circleId) });
      await batch.commit();
      setMyCircles((prev) => prev.filter((c) => c.id !== circleId));
      setViewingGroupDetail(false);
      triggerToast('You left the circle.');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `circles/${circleId}/members`);
    }
  };

  const disbandCircle = async (circleId: string) => {
    if (!auth.currentUser) return;
    try {
      // Firestore has no cascading delete, so every subcollection has to be
      // cleared by hand or it lingers forever, unreachable. Everything is
      // READ first, while we're still a member (most of these are
      // members-only), then deleted.
      const circleRef = doc(db, 'circles', circleId);
      const [circleSnap, membersSnap, plansSnap, messagesSnap, reactionsSnap, challengesSnap, bannedSnap, responsesSnap, takeawaysSnap, statsSnap] =
        await Promise.all([
          getDoc(circleRef),
          getDocs(collection(db, 'circles', circleId, 'members')),
          getDocs(collection(db, 'circles', circleId, 'groupPlans')),
          getDocs(collection(db, 'circles', circleId, 'messages')),
          getDocs(collection(db, 'circles', circleId, 'reactions')),
          getDocs(collection(db, 'circles', circleId, 'challenges')),
          getDocs(collection(db, 'circles', circleId, 'banned')),
          getDocs(collection(db, 'circles', circleId, 'responses')),
          getDocs(collection(db, 'circles', circleId, 'takeaways')),
          getDocs(collection(db, 'circles', circleId, 'memberStats')),
        ]);
      const participantSnaps = await Promise.all(
        challengesSnap.docs.map((c) => getDocs(collection(c.ref, 'participants')))
      );
      const replySnaps = await Promise.all(takeawaysSnap.docs.map((t) => getDocs(collection(t.ref, 'replies'))));
      const inviteCode = (circleSnap.data() as Circle | undefined)?.inviteCode;
      const inviteSnap = inviteCode ? await getDoc(doc(db, 'circleInvites', inviteCode)) : null;

      // Order matters: participants before their challenge (their delete
      // rule reads the challenge), replies before their shared takeaway
      // (likewise), and the member docs + circle doc go in
      // the very last batch, because every delete rule here checks the
      // circle's ownerId.
      const refs = [
        ...participantSnaps.flatMap((s) => s.docs.map((d) => d.ref)),
        ...challengesSnap.docs.map((d) => d.ref),
        ...replySnaps.flatMap((s) => s.docs.map((d) => d.ref)),
        ...takeawaysSnap.docs.map((d) => d.ref),
        ...statsSnap.docs.map((d) => d.ref),
        ...reactionsSnap.docs.map((d) => d.ref),
        ...responsesSnap.docs.map((d) => d.ref),
        ...messagesSnap.docs.map((d) => d.ref),
        ...plansSnap.docs.map((d) => d.ref),
        ...bannedSnap.docs.map((d) => d.ref),
        ...(inviteSnap?.exists() && inviteSnap.data().circleId === circleId ? [inviteSnap.ref] : []),
        ...membersSnap.docs.map((d) => d.ref),
        circleRef,
      ];
      const BATCH_LIMIT = 450; // Firestore caps a batch at 500 writes
      for (let i = 0; i < refs.length; i += BATCH_LIMIT) {
        const batch = writeBatch(db);
        refs.slice(i, i + BATCH_LIMIT).forEach((r) => batch.delete(r));
        await batch.commit();
      }

      // Other members' profiles/{uid}.circleIds still reference this circle —
      // we can't write their profile docs (owner-only), so loadMyCircles()
      // self-heals for them next time they load. We can clean up our own.
      await updateDoc(doc(db, 'profiles', auth.currentUser.uid), { circleIds: arrayRemove(circleId) });

      setMyCircles((prev) => prev.filter((c) => c.id !== circleId));
      setViewingGroupDetail(false);
      triggerToast('Circle disbanded.');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `circles/${circleId}`);
    }
  };

  // The ban doc rides in the same batch: without it the removed member
  // could simply rejoin (firestore.rules' join rule checks banned/{uid}).
  // Their shared takeaways (and the replies on them) go first, while the
  // leader can still list them; best effort, since the circle's list hides
  // anyone who isn't a member anyway. Their weekly stats doc goes in the kick
  // batch (the totals skip non-members too).
  const removeCircleMember = async (circleId: string, memberUid: string) => {
    try {
      await removeSharesBy(circleId, memberUid).catch((err) => console.error('Failed to remove their shared takeaways:', err));
      const batch = writeBatch(db);
      batch.delete(doc(db, 'circles', circleId, 'members', memberUid));
      batch.delete(doc(db, 'circles', circleId, 'memberStats', memberUid));
      batch.set(doc(db, 'circles', circleId, 'banned', memberUid), {
        uid: memberUid,
        bannedAt: new Date().toISOString(),
      });
      await batch.commit();
      setActiveCircleMembers((prev) => prev.filter((m) => m.uid !== memberUid));
      triggerToast('Member removed.');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `circles/${circleId}/members/${memberUid}`);
    }
  };

  const updateCircleSettings = async (circleId: string, fields: Partial<Pick<Circle, 'name' | 'description' | 'isPublic'>>) => {
    try {
      await updateDoc(doc(db, 'circles', circleId), { ...fields, updatedAt: new Date().toISOString() });
      setActiveCircle((prev) => (prev ? { ...prev, ...fields } : prev));
      setMyCircles((prev) => prev.map((c) => (c.id === circleId ? { ...c, ...fields } : c)));
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, `circles/${circleId}`);
    }
  };

  /** Closes whichever circle page was open; called on every auth transition. */
  const resetActiveCircle = () => {
    setActiveCircle(null);
    setActiveCircleMembers([]);
    setViewingGroupDetail(false);
    setActiveGroupId('');
    setCommunitySubView('home');
  };

  /** Signed out: no circles, no co-members. */
  const resetMyCircles = () => {
    setMyCircles([]);
    setCircleFriends([]);
  };

  return {
    myCircles,
    loadingMyCircles,
    publicCircles,
    loadingPublicCircles,
    activeCircle,
    activeCircleMembers,
    loadingActiveCircle,
    circleFriends,
    activityEvents,
    loadingActivityEvents,
    viewingGroupDetail,
    setViewingGroupDetail,
    communitySubView,
    setCommunitySubView,
    activeGroupId,
    previewCircle,
    openCirclePreview,
    closeCirclePreview,
    inviteCodeInput,
    setInviteCodeInput,
    loadMyCircles,
    loadCircleFriends,
    loadActivityFeed,
    loadPublicCircles,
    loadActiveCircleData,
    openCircle,
    createCircle,
    joinCircle,
    joinCircleByCode,
    leaveCircle,
    disbandCircle,
    removeCircleMember,
    updateCircleSettings,
    resetActiveCircle,
    resetMyCircles,
  };
}
