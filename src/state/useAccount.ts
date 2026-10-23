import { useState, type MutableRefObject } from 'react';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  setDoc,
  writeBatch,
} from 'firebase/firestore';
import { deleteObject, ref as storageRef } from 'firebase/storage';
import {
  deleteUser,
  EmailAuthProvider,
  reauthenticateWithCredential,
  signOut as firebaseSignOut,
  updateProfile,
} from 'firebase/auth';
import { auth, db, storage } from '../firebase';
import { Circle, QueueItem } from '../types';

// ============================================================================
// ACCOUNT AND PROFILE SETTINGS
// ----------------------------------------------------------------------------
// The account-level actions: signing out, the display name, default recording
// visibility, sharing your verse list with friends, finishing setup, and
// deleting the account. Loading a user's data on sign-in (loadUserData) stays
// in useAppState, since its job is filling in every other hook. Split out of
// useAppState (see .claude/file-split-plan.md).
// ============================================================================

interface UseAccountDeps {
  setUser: (user: any) => void;
  myCircles: Circle[];
  /** Always-current queue (see updateMemoryQueue in useAppState). */
  memoryQueueRef: MutableRefObject<QueueItem[]>;
  wipeAudioCache: () => Promise<void>;
  wipeLocalPhotos: () => Promise<void>;
  /** Stops push notifications to this phone for the signed-in account. */
  unregisterPushToken: () => Promise<void>;
  /** Takes this person's takeaways out of every circle they were shared with (useTakeaways). */
  removeAllSharedTakeaways: () => Promise<void>;
  triggerToast: (message: string) => void;
}

export function useAccount({
  setUser,
  myCircles,
  memoryQueueRef,
  wipeAudioCache,
  wipeLocalPhotos,
  unregisterPushToken,
  removeAllSharedTakeaways,
  triggerToast,
}: UseAccountDeps) {
  // Per-recording visibility choice for the Save dialog. Pre-filled from
  // profiles/{uid}.defaultRecordingVisibility (whatever the user picked the
  // very first time they saved a recording); null means "no default yet,"
  // in which case the dialog defaults its picker to 'private' but does not
  // treat that as an already-set preference.
  const [defaultRecordingVisibility, setDefaultRecordingVisibility] = useState<
    'private' | 'circle' | 'public' | null
  >(null);

  // Profile-sharing visibility: whether this user's verse list is shown to
  // friends on their member profile. Defaults to 'private' (only you). When
  // set to 'friends', a denormalized snapshot is written to
  // profiles/{uid}/shared/memoryQueue (friends-only per the rules) so friends
  // can read it without access to this user's private memoryQueue — kept
  // fresh by the debounced profile sync effect in useAppState, and deleted when
  // flipped to 'private'.
  //
  // There is deliberately no equivalent for Review Settings: sharing your
  // retention method was removed outright (see the note in usePlanSettings),
  // so `memoryPlanVisibility` and its snapshot are gone.
  const [memoryQueueVisibility, setMemoryQueueVisibility] = useState<'private' | 'friends'>('private');

  // First-run SETUP overlay -- shown automatically whenever the loaded/created
  // profile's onboardingCompleted field isn't true (loadUserData sets this),
  // and re-openable anytime from Settings.
  //
  // This replaced a four-step "Getting Started" checklist that walked the user
  // out to real screens one at a time, locking each step behind the previous
  // one and swapping the tab bar for a "Back to Guide" bar so they couldn't
  // wander off. Three things were wrong with it: it taught NAVIGATION rather
  // than the idea (never once explaining what the app actually does), its
  // first stop was the retention editor -- the single most jargon-dense screen
  // in the app -- and it was a tour, so finishing it left the user with a
  // still-empty app and nothing configured.
  //
  // The replacement asks three questions and ACTS on the answers, so a user
  // who finishes it has verses queued and a schedule set. Nothing is locked
  // and every card is skippable.
  const [showOnboarding, setShowOnboarding] = useState(false);

  const signOut = async () => {
    // Before signing out, while we still may: this phone shouldn't keep
    // getting the old account's messages.
    await unregisterPushToken();
    await firebaseSignOut(auth);
  };

  // Firebase's `User` object is mutated in place by updateProfile() -- simply
  // re-setting `user` to the same reference (auth.currentUser) wouldn't
  // trigger a re-render. Spreading its own enumerable properties into a
  // plain object gives a genuinely new reference while staying duck-type
  // compatible with every `user?.displayName`/`user?.uid`/`user?.photoURL`
  // read elsewhere in the app (all simple property reads, no method calls).
  const updateDisplayName = async (name: string) => {
    const trimmed = name.trim();
    if (!trimmed || !auth.currentUser) return;
    try {
      await updateProfile(auth.currentUser, { displayName: trimmed });
      await setDoc(
        doc(db, 'profiles', auth.currentUser.uid),
        { displayName: trimmed, displayNameLower: trimmed.toLowerCase(), updatedAt: new Date() },
        { merge: true }
      );
      setUser({ ...auth.currentUser } as any);
      triggerToast('Display name updated!');
    } catch (err) {
      console.error('Failed to update display name:', err);
      triggerToast('Failed to update display name.');
    }
  };

  // Unlike the implicit first-save default (set once, silently, the first
  // time someone saves a recording), this is a real, always-available
  // editor for the same profiles/{uid}.defaultRecordingVisibility field.
  const updateDefaultRecordingVisibility = async (vis: 'private' | 'circle' | 'public') => {
    setDefaultRecordingVisibility(vis);
    if (!auth.currentUser) return;
    try {
      await setDoc(doc(db, 'profiles', auth.currentUser.uid), { defaultRecordingVisibility: vis }, { merge: true });
      triggerToast('Default recording visibility updated!');
    } catch (err) {
      console.error('Failed to update default recording visibility:', err);
      triggerToast('Failed to update default recording visibility.');
    }
  };

  // Compact, friend-readable snapshot of the memory queue -- just enough for a
  // friend's profile to show what references someone is working on and their
  // status, without exposing full verse text or private scheduling state.
  const buildSharedQueueSnapshot = () =>
    memoryQueueRef.current.map((item) => ({
      book: item.book,
      chapter: item.chapter,
      verseNumber: item.verseNumber,
      // Lets a friend's quiz (src/lib/chatAttachments.ts) name the exact
      // translation this verse is being learned in.
      translationId: item.translationId,
      status: item.status,
      orderIndex: item.orderIndex,
    }));

  // The snapshot lives in its own friends-only doc, not on the profile
  // (which anyone signed in can list) -- see firestore.rules.
  const sharedQueueDocRef = (uid: string) => doc(db, 'profiles', uid, 'shared', 'memoryQueue');
  const writeSharedQueueSnapshot = (uid: string) =>
    setDoc(sharedQueueDocRef(uid), { items: buildSharedQueueSnapshot(), updatedAt: new Date().toISOString() });

  // Settings toggle: show/hide this user's verse list on their member profile
  // for friends. Writes the visibility flag + (when 'friends') a fresh
  // snapshot; deletes the snapshot doc when set to 'private'. The debounced
  // profile-sync effect keeps the snapshot current afterward.
  const updateMemoryQueueVisibility = async (vis: 'private' | 'friends') => {
    setMemoryQueueVisibility(vis);
    if (!auth.currentUser) return;
    const uid = auth.currentUser.uid;
    try {
      if (vis === 'friends') await writeSharedQueueSnapshot(uid);
      else await deleteDoc(sharedQueueDocRef(uid));
      await setDoc(
        doc(db, 'profiles', uid),
        // Also clears the old on-profile copy, in case it's still there.
        { memoryQueueVisibility: vis, sharedMemoryQueue: deleteField() },
        { merge: true }
      );
      triggerToast(vis === 'friends' ? 'Your verses are now visible to friends.' : 'Your verses are now private.');
    } catch (err) {
      console.error('Failed to update memory queue visibility:', err);
      triggerToast('Failed to update memory queue visibility.');
    }
  };

  // Closes setup and records that it's been seen, so it doesn't reappear on
  // the next launch. Called both by "Skip" and by finishing the last card --
  // there is no partial-completion state to track, because each card commits
  // its own answer as it's answered rather than at the end.
  const dismissOnboarding = async () => {
    setShowOnboarding(false);
    if (!auth.currentUser) return;
    try {
      await setDoc(doc(db, 'profiles', auth.currentUser.uid), { onboardingCompleted: true }, { merge: true });
    } catch (err) {
      console.error('Failed to persist onboarding completion:', err);
    }
  };

  // Permanently deletes the signed-in account: every memoryQueue/verses/
  // recordings doc (+ their Storage audio files), the memoryPlans doc, this
  // member's doc in every circle they belong to, the profiles doc, and
  // finally the Firebase Auth user itself.
  //
  // Ordering is deliberate and safety-critical: `reauthPassword`, if given,
  // is applied FIRST, before touching any data. Firebase only reveals a
  // stale session by throwing 'auth/requires-recent-login' from deleteUser()
  // itself -- which is necessarily the LAST step (once it succeeds,
  // auth.currentUser is gone and any further Firestore write would fail
  // security rules requiring request.auth). Reauthenticating reactively
  // *after* deletion would risk the exact worst case this function must
  // avoid: real user data wiped, but the login credential still standing.
  // Doing it up front instead means the whole operation runs under a
  // guaranteed-fresh session or doesn't start at all.
  //
  // Google-signed-in accounts can't reauthenticate here directly (that flow
  // lives in the separate useGoogleSignIn hook, which needs a live component
  // to call from) -- SettingsScreen re-invokes signInWithGoogle() itself
  // first for those accounts, then calls this with no password.
  const deleteAccount = async (
    reauthPassword?: string
  ): Promise<{ ok: true } | { ok: false; requiresReauth: boolean; message: string }> => {
    if (!auth.currentUser) return { ok: false, requiresReauth: false, message: 'Not signed in.' };
    try {
      if (reauthPassword && auth.currentUser.email) {
        const cred = EmailAuthProvider.credential(auth.currentUser.email, reauthPassword);
        await reauthenticateWithCredential(auth.currentUser, cred);
      }

      const uid = auth.currentUser.uid;
      const myEmail = (auth.currentUser.email || '').toLowerCase();
      // Shared takeaways first, while still a member of those circles (their
      // replies can only be listed by a member). Best effort: it never stops
      // the account itself from being deleted.
      await removeAllSharedTakeaways().catch((err) => console.error('Failed to remove shared takeaways:', err));
      const [queueSnap, versesSnap, recordingsSnap, sectionsSnap, takeawaysSnap, emailLookupSnap] = await Promise.all([
        getDocs(collection(db, 'users', uid, 'memoryQueue')),
        getDocs(collection(db, 'users', uid, 'verses')),
        getDocs(collection(db, 'users', uid, 'recordings')),
        getDocs(collection(db, 'users', uid, 'chapterSections')),
        getDocs(collection(db, 'users', uid, 'takeaways')),
        myEmail && !myEmail.includes('/') ? getDoc(doc(db, 'emailLookup', myEmail)) : Promise.resolve(null),
      ]);

      const batch = writeBatch(db);
      queueSnap.docs.forEach((d) => batch.delete(d.ref));
      versesSnap.docs.forEach((d) => batch.delete(d.ref));
      recordingsSnap.docs.forEach((d) => batch.delete(d.ref));
      sectionsSnap.docs.forEach((d) => batch.delete(d.ref));
      takeawaysSnap.docs.forEach((d) => batch.delete(d.ref));
      batch.delete(doc(db, 'memoryPlans', uid));
      batch.delete(sharedQueueDocRef(uid));
      // Only if it's really ours -- the rule reads the existing doc's uid,
      // so deleting a missing one would fail the whole batch.
      if (emailLookupSnap?.exists() && emailLookupSnap.data().uid === uid) batch.delete(emailLookupSnap.ref);
      // Known limitation, documented rather than solved this pass: if this
      // member owns/leads any of these circles, its ownerId is simply left
      // pointing at the now-deleted uid -- same "orphaned reference, self-
      // heals on next load" tolerance loadMyCircles already has elsewhere.
      myCircles.forEach((c) => batch.delete(doc(db, 'circles', c.id, 'members', uid)));
      batch.delete(doc(db, 'profiles', uid));
      await batch.commit();

      // Storage deletes can't ride in a Firestore batch -- best-effort, one
      // failed audio file shouldn't block the rest of account deletion.
      await Promise.all(
        recordingsSnap.docs.flatMap((d) => {
          // Both the raw upload and its studio render have to go — see
          // deleteRecording for the same pairing.
          const paths = [d.data().audioPath, d.data().studioAudioPath].filter(Boolean) as string[];
          return paths.map(async (path) => {
            try {
              await deleteObject(storageRef(storage, path));
            } catch (err) {
              console.error('Failed to delete a recording audio file during account deletion:', err);
            }
          });
        })
      );

      // Wipe the on-device cache outright rather than letting sign-out's
      // releaseAudioCache leave the files for a next sign-in that will never
      // come. Deleting the account should not leave its recitations readable
      // on disk for whoever signs in next.
      await wipeAudioCache();
      await wipeLocalPhotos();

      await deleteUser(auth.currentUser);
      return { ok: true };
    } catch (err: any) {
      if (err?.code === 'auth/requires-recent-login') {
        return { ok: false, requiresReauth: true, message: 'Please confirm your identity to delete your account.' };
      }
      if (err?.code === 'auth/wrong-password' || err?.code === 'auth/invalid-credential') {
        return { ok: false, requiresReauth: true, message: 'Incorrect password.' };
      }
      console.error('Failed to delete account:', err);
      return { ok: false, requiresReauth: false, message: 'Failed to delete account. Please try again.' };
    }
  };

  return {
    defaultRecordingVisibility,
    setDefaultRecordingVisibility,
    memoryQueueVisibility,
    setMemoryQueueVisibility,
    showOnboarding,
    setShowOnboarding,
    signOut,
    updateDisplayName,
    updateDefaultRecordingVisibility,
    writeSharedQueueSnapshot,
    updateMemoryQueueVisibility,
    dismissOnboarding,
    deleteAccount,
  };
}
