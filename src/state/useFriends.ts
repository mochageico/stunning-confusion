import { useEffect, useRef, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';

import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import type { Friend, FriendRequest } from '../types';

// Split out of useAppState (see .claude/file-split-plan.md).

interface FriendsDeps {
  triggerToast: (message: string) => void;
}

export function useFriends({ triggerToast }: FriendsDeps) {
  // Real friends — a mutual, persistent connection independent of circle
  // membership, replacing "Friends" being just live circle co-membership.
  const [friends, setFriends] = useState<Friend[]>([]);
  const [loadingFriends, setLoadingFriends] = useState(false);
  const [incomingFriendRequests, setIncomingFriendRequests] = useState<FriendRequest[]>([]);
  const [outgoingFriendRequests, setOutgoingFriendRequests] = useState<FriendRequest[]>([]);
  const [userSearchQuery, setUserSearchQuery] = useState('');
  const [userSearchResults, setUserSearchResults] = useState<
    Array<{ uid: string; displayName: string; avatarUrl: string }>
  >([]);
  const [searchingUsers, setSearchingUsers] = useState(false);
  const userSearchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ==========================================
  // REAL FRIENDS SYSTEM — search, requests, accept/decline, unfriend.
  // Independent of circles: a friendship is mutual and persists even if you
  // never share a circle again (unlike circleFriends, live-recomputed
  // co-membership).
  // ==========================================
  const loadFriends = async () => {
    if (!auth.currentUser) {
      setFriends([]);
      return;
    }
    setLoadingFriends(true);
    try {
      const uid = auth.currentUser.uid;
      const snap = await getDocs(collection(db, 'profiles', uid, 'friends'));
      const rawFriends = snap.docs.map((d) => d.data() as Friend);

      // The other side of a friendship doesn't get cleaned up when an
      // account is deleted (deleteAccount only removes the deleted user's
      // own docs) -- same "orphaned reference, self-heals on next load"
      // tolerance used for circle ownerId elsewhere. Verify each friend's
      // profile still exists here and prune any that don't.
      const profiles = await Promise.all(
        rawFriends.map((f) => getDoc(doc(db, 'profiles', f.uid)).then((s) => (s.exists() ? s.data() : null)))
      );
      // Name and photo come from the live profile, not the friends doc: the
      // friends doc is a snapshot from the day you became friends, so a
      // later name change or new photo never reached it.
      const liveFriends = rawFriends
        .map((f, i) => {
          const p = profiles[i];
          return p ? { ...f, displayName: p.displayName || f.displayName, avatarUrl: p.avatarUrl || f.avatarUrl || '' } : null;
        })
        .filter((f): f is Friend => f !== null);
      const staleFriends = rawFriends.filter((_, i) => !profiles[i]);

      setFriends(liveFriends);

      if (staleFriends.length > 0) {
        const cleanupBatch = writeBatch(db);
        staleFriends.forEach((f) => cleanupBatch.delete(doc(db, 'profiles', uid, 'friends', f.uid)));
        cleanupBatch.commit().catch((err) => console.error('Failed to prune stale friend entries:', err));
      }
    } catch (err) {
      console.error('Failed to load friends:', err);
    } finally {
      setLoadingFriends(false);
    }
  };

  const loadFriendRequests = async () => {
    if (!auth.currentUser) {
      setIncomingFriendRequests([]);
      setOutgoingFriendRequests([]);
      return;
    }
    const uid = auth.currentUser.uid;
    try {
      const [incomingSnap, outgoingSnap] = await Promise.all([
        getDocs(query(collection(db, 'friendRequests'), where('toUid', '==', uid), where('status', '==', 'pending'))),
        getDocs(query(collection(db, 'friendRequests'), where('fromUid', '==', uid), where('status', '==', 'pending'))),
      ]);
      setIncomingFriendRequests(incomingSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as FriendRequest));
      setOutgoingFriendRequests(outgoingSnap.docs.map((d) => ({ id: d.id, ...d.data() }) as FriendRequest));
    } catch (err) {
      console.error('Failed to load friend requests:', err);
    }
  };

  // No backend/search service in this project, so this is the standard
  // Firestore-only approach: exact match on email, or a prefix range-query
  // on the lowercased name (see displayNameLower in loadUserData). Email is
  // no longer on profiles (anyone could list them) -- an exact address is
  // resolved through emailLookup/{email} -> uid instead, and results never
  // carry anyone's email back to the searcher.
  const searchUsers = async (rawQuery: string) => {
    const q = rawQuery.trim();
    if (!q || !auth.currentUser) {
      setUserSearchResults([]);
      return;
    }
    setSearchingUsers(true);
    try {
      let profileDocs: Array<{ id: string; data: () => any }>;
      if (q.includes('@')) {
        const email = q.toLowerCase();
        const lookupSnap = email.includes('/') ? null : await getDoc(doc(db, 'emailLookup', email));
        const foundUid = lookupSnap?.exists() ? (lookupSnap.data().uid as string) : null;
        const profileSnap = foundUid ? await getDoc(doc(db, 'profiles', foundUid)) : null;
        profileDocs = profileSnap?.exists() ? [profileSnap] : [];
      } else {
        const lower = q.toLowerCase();
        const snap = await getDocs(
          query(
            collection(db, 'profiles'),
            orderBy('displayNameLower'),
            where('displayNameLower', '>=', lower),
            where('displayNameLower', '<', lower + '\uf8ff'),
            limit(10)
          )
        );
        profileDocs = snap.docs;
      }
      const results = profileDocs
        .filter((d) => d.id !== auth.currentUser?.uid)
        .map((d) => {
          const data = d.data();
          return {
            uid: d.id,
            displayName: data.displayName || 'Anonymous Disciple',
            avatarUrl: data.avatarUrl || '',
          };
        });
      setUserSearchResults(results);
    } catch (err) {
      console.error('Failed to search users:', err);
      triggerToast("Couldn't search. Try again.");
    } finally {
      setSearchingUsers(false);
    }
  };

  // Live "as you type" friend search, debounced so it does not fire a
  // Firestore query on every keystroke. searchUsers itself already does a
  // prefix match on displayNameLower, so this just makes results appear
  // while typing instead of requiring Enter or the Search button.
  useEffect(() => {
    if (userSearchDebounceRef.current) clearTimeout(userSearchDebounceRef.current);
    if (!userSearchQuery.trim()) {
      setUserSearchResults([]);
      return;
    }
    userSearchDebounceRef.current = setTimeout(() => {
      searchUsers(userSearchQuery);
    }, 300);
    return () => {
      if (userSearchDebounceRef.current) clearTimeout(userSearchDebounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userSearchQuery]);

  // Deterministic doc id (not auto-generated) so re-sending a request to the
  // same person is idempotent rather than creating duplicates.
  const sendFriendRequest = async (toUid: string, toName: string) => {
    if (!auth.currentUser || auth.currentUser.uid === toUid) return;
    const fromUid = auth.currentUser.uid;
    const requestId = `${fromUid}_${toUid}`;
    try {
      await setDoc(doc(db, 'friendRequests', requestId), {
        fromUid,
        fromName: auth.currentUser.displayName || 'Anonymous Disciple',
        toUid,
        toName,
        status: 'pending',
        createdAt: new Date().toISOString(),
      });
      triggerToast(`Friend request sent to ${toName}.`);
      loadFriendRequests();
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `friendRequests/${requestId}`);
    }
  };

  const acceptFriendRequest = async (request: FriendRequest) => {
    if (!auth.currentUser) return;
    const myUid = auth.currentUser.uid;
    try {
      const batch = writeBatch(db);
      // respondedAt must be the server's clock and land in this same batch:
      // firestore.rules only lets the two friends docs be created by the
      // write that accepts the request.
      batch.update(doc(db, 'friendRequests', request.id), { status: 'accepted', respondedAt: serverTimestamp() });
      const friendsSince = new Date().toISOString();
      batch.set(doc(db, 'profiles', myUid, 'friends', request.fromUid), {
        uid: request.fromUid,
        displayName: request.fromName,
        avatarUrl: '', // filled from their live profile by loadFriends
        friendsSince,
      });
      batch.set(doc(db, 'profiles', request.fromUid, 'friends', myUid), {
        uid: myUid,
        displayName: auth.currentUser.displayName || 'Anonymous Disciple',
        avatarUrl: auth.currentUser.photoURL || '',
        friendsSince,
      });
      await batch.commit();
      triggerToast(`You and ${request.fromName} are now friends.`);
      loadFriendRequests();
      loadFriends();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `friendRequests/${request.id}`);
    }
  };

  const declineFriendRequest = async (request: FriendRequest) => {
    try {
      await updateDoc(doc(db, 'friendRequests', request.id), { status: 'declined', respondedAt: serverTimestamp() });
      setIncomingFriendRequests((prev) => prev.filter((r) => r.id !== request.id));
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `friendRequests/${request.id}`);
    }
  };

  const cancelFriendRequest = async (request: FriendRequest) => {
    try {
      await deleteDoc(doc(db, 'friendRequests', request.id));
      setOutgoingFriendRequests((prev) => prev.filter((r) => r.id !== request.id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `friendRequests/${request.id}`);
    }
  };

  const removeFriend = async (friend: Friend) => {
    if (!auth.currentUser) return;
    const myUid = auth.currentUser.uid;
    try {
      // Also clear the request that made this friendship (whichever way it
      // went), so either side can send a fresh one later -- an 'accepted'
      // leftover would otherwise block the sender's re-send flow.
      const requestRefs = [
        doc(db, 'friendRequests', `${myUid}_${friend.uid}`),
        doc(db, 'friendRequests', `${friend.uid}_${myUid}`),
      ];
      const requestSnaps = await Promise.all(requestRefs.map((r) => getDoc(r)));
      const batch = writeBatch(db);
      batch.delete(doc(db, 'profiles', myUid, 'friends', friend.uid));
      batch.delete(doc(db, 'profiles', friend.uid, 'friends', myUid));
      requestSnaps.forEach((s) => {
        if (s.exists()) batch.delete(s.ref);
      });
      await batch.commit();
      setFriends((prev) => prev.filter((f) => f.uid !== friend.uid));
      triggerToast(`Removed ${friend.displayName} from friends.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `profiles/${myUid}/friends/${friend.uid}`);
    }
  };

  return {
    friends,
    loadingFriends,
    incomingFriendRequests,
    outgoingFriendRequests,
    userSearchQuery,
    setUserSearchQuery,
    userSearchResults,
    searchingUsers,
    loadFriends,
    loadFriendRequests,
    searchUsers,
    sendFriendRequest,
    acceptFriendRequest,
    declineFriendRequest,
    cancelFriendRequest,
    removeFriend,
  };
}
