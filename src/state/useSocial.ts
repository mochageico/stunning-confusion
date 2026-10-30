import { useEffect, useMemo, useRef, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';

import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import type { ChatMessage, Circle, DMThread, Friend } from '../types';
import type { ChatResponse } from '../lib/chatAttachments';

// ============================================================================
// SAFETY, UNREAD AND CHAT-CARD ANSWERS
// ----------------------------------------------------------------------------
// The social pieces added after the community deep dive (2026-10-18), kept
// out of useAppState's 7,000 lines. useAppState calls this once and spreads
// the result into AppState, so screens use it like everything else.
//
// - Blocking: profiles/{me}/blocked/{uid}. The rules use it to close DMs,
//   nudges, friend requests and challenges in both directions; this hook
//   uses it to hide the person everywhere on my own screens.
// - Reporting: reports/{id}, write-only (App Store guideline 1.2).
// - Community guidelines: accepted once, users/{me}/settings/community.
// - Unread: users/{me}/readMarkers/{dm_<threadId> | circle_<circleId>}
//   against each thread's lastMessageAt / each circle's newest message.
// - Card answers: the open chat's responses/ collection (see ChatResponse).
// ============================================================================

export interface BlockedUser {
  uid: string;
  displayName: string;
  blockedAt: string;
}

export type ReportKind = 'user' | 'dmMessage' | 'circleMessage' | 'recording' | 'circle';

export const REPORT_REASONS = [
  { id: 'harassment', label: 'Harassment or bullying' },
  { id: 'inappropriate', label: 'Sexual or inappropriate content' },
  { id: 'hate', label: 'Hate or violence' },
  { id: 'spam', label: 'Spam or scam' },
  { id: 'impersonation', label: 'Pretending to be someone else' },
  { id: 'other', label: 'Something else' },
] as const;

export type ChatScope = 'dm' | 'circle';

interface SocialDeps {
  user: { uid: string; displayName?: string | null } | null;
  friends: Friend[];
  myCircles: Circle[];
  dmThreads: DMThread[];
  activeDMThread: DMThread | null;
  activeDMMessages: ChatMessage[];
  activeCircleChatId: string | null;
  activeCircleMessages: ChatMessage[];
  triggerToast: (msg: string) => void;
  /** Refreshes friends + requests after a block removes a friendship. */
  reloadFriends: () => void;
}

const containerPath = (scope: ChatScope, containerId: string) =>
  scope === 'dm' ? ['dmThreads', containerId] : ['circles', containerId];

export function useSocial(deps: SocialDeps) {
  const { user, triggerToast } = deps;

  // ---------------------------------------------------------------- blocking
  const [blockedUsers, setBlockedUsers] = useState<BlockedUser[]>([]);
  const blockedUids = useMemo(() => new Set(blockedUsers.map((b) => b.uid)), [blockedUsers]);

  useEffect(() => {
    if (!user) {
      setBlockedUsers([]);
      return;
    }
    const unsub = onSnapshot(
      collection(db, 'profiles', user.uid, 'blocked'),
      (snap) => setBlockedUsers(snap.docs.map((d) => d.data() as BlockedUser)),
      (err) => console.error('Failed to load blocked users:', err)
    );
    return unsub;
  }, [user?.uid]);

  /**
   * Blocks someone: they can no longer message, nudge, friend-request or
   * challenge me (enforced by the rules), and they disappear from my feeds.
   * Any friendship and pending request between us goes too -- otherwise
   * unblocking would silently restore a friendship I chose to cut.
   */
  const blockUser = async (uid: string, displayName: string) => {
    if (!auth.currentUser || uid === auth.currentUser.uid) return;
    const me = auth.currentUser.uid;
    try {
      const batch = writeBatch(db);
      batch.set(doc(db, 'profiles', me, 'blocked', uid), {
        uid,
        displayName: displayName || 'Someone',
        blockedAt: new Date().toISOString(),
      });
      if (deps.friends.some((f) => f.uid === uid)) {
        batch.delete(doc(db, 'profiles', me, 'friends', uid));
        batch.delete(doc(db, 'profiles', uid, 'friends', me));
      }
      await batch.commit();
      // Pending requests either way -- separate writes, since a request
      // that doesn't exist can't go in the batch (delete of a missing doc
      // is fine, but reading first keeps the error log clean).
      await Promise.all(
        [`${me}_${uid}`, `${uid}_${me}`].map(async (id) => {
          const ref = doc(db, 'friendRequests', id);
          const snap = await getDoc(ref).catch(() => null);
          if (snap?.exists()) await deleteDoc(ref).catch(() => undefined);
        })
      );
      deps.reloadFriends();
      triggerToast(`${displayName || 'They'} won't be able to contact you.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `profiles/${me}/blocked/${uid}`);
      triggerToast("Couldn't block. Try again.");
    }
  };

  const unblockUser = async (uid: string) => {
    if (!auth.currentUser) return;
    try {
      await deleteDoc(doc(db, 'profiles', auth.currentUser.uid, 'blocked', uid));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `profiles/${auth.currentUser.uid}/blocked/${uid}`);
    }
  };

  // --------------------------------------------------------------- reporting
  const reportContent = async (input: {
    kind: ReportKind;
    targetUid?: string;
    /** Firestore path of the reported thing (message, recording, circle). */
    targetPath?: string;
    contentSnapshot?: string;
    reason: string;
    note?: string;
  }) => {
    if (!auth.currentUser) return false;
    try {
      await setDoc(doc(collection(db, 'reports')), {
        reporterUid: auth.currentUser.uid,
        reporterName: auth.currentUser.displayName || '',
        kind: input.kind,
        targetUid: input.targetUid || '',
        targetPath: input.targetPath || '',
        contentSnapshot: (input.contentSnapshot || '').slice(0, 2000),
        reason: input.reason,
        note: (input.note || '').slice(0, 1000),
        status: 'open',
        createdAt: serverTimestamp(),
      });
      triggerToast('Thanks. We got your report and will look at it within 24 hours.');
      return true;
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'reports');
      triggerToast("Couldn't send the report. Try again.");
      return false;
    }
  };

  // ------------------------------------------------- unsending a message
  /**
   * Deletes a chat message: your own anywhere, or anyone's in a circle you
   * lead. Reactions and answers on it are left; nothing renders them once
   * the message is gone. A DM thread's inbox preview is rolled back to the
   * message before, so the deleted text doesn't live on there.
   */
  const deleteChatMessage = async (scope: ChatScope, containerId: string, message: ChatMessage) => {
    const [col, id] = containerPath(scope, containerId);
    try {
      await deleteDoc(doc(db, col, id, 'messages', message.id));
      if (scope === 'dm') {
        const list = deps.activeDMMessages;
        if (list.length > 0 && list[list.length - 1].id === message.id) {
          const prev = list.length > 1 ? list[list.length - 2] : null;
          await updateDoc(doc(db, 'dmThreads', containerId), {
            lastMessage: prev ? prev.text : '',
            lastMessageAt: prev ? prev.createdAt : message.createdAt,
            lastMessageFromUid: prev ? prev.fromUid : '',
          }).catch((err) => console.error('Failed to roll back DM preview:', err));
        }
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `${col}/${id}/messages/${message.id}`);
      triggerToast("Couldn't delete that message.");
    }
  };

  // ---------------------------------------------------- community guidelines
  // undefined = still loading (don't flash the sheet), null = not accepted.
  const [guidelinesAcceptedAt, setGuidelinesAcceptedAt] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    if (!user) {
      setGuidelinesAcceptedAt(undefined);
      return;
    }
    getDoc(doc(db, 'users', user.uid, 'settings', 'community'))
      .then((snap) => setGuidelinesAcceptedAt(snap.data()?.guidelinesAcceptedAt ?? null))
      .catch(() => setGuidelinesAcceptedAt(null));
  }, [user?.uid]);

  // The guidelines sheet (rendered once, in App.tsx). Opened the first time
  // someone tries to post anything, or opens Community.
  const [guidelinesPromptOpen, setGuidelinesPromptOpen] = useState(false);
  const requireCommunityGuidelines = () => setGuidelinesPromptOpen(true);
  const closeCommunityGuidelines = () => setGuidelinesPromptOpen(false);

  const acceptCommunityGuidelines = async () => {
    if (!auth.currentUser) return;
    const at = new Date().toISOString();
    setGuidelinesAcceptedAt(at);
    setGuidelinesPromptOpen(false);
    await setDoc(doc(db, 'users', auth.currentUser.uid, 'settings', 'community'), { guidelinesAcceptedAt: at }, { merge: true }).catch(
      (err) => console.error('Failed to save guidelines acceptance:', err)
    );
  };

  // ------------------------------------------------------------------ unread
  const [readMarkers, setReadMarkers] = useState<Record<string, string>>({});
  // Newest message per circle I'm in: { at, fromUid }.
  const [circleLatest, setCircleLatest] = useState<Record<string, { at: string; fromUid: string }>>({});

  useEffect(() => {
    if (!user) {
      setReadMarkers({});
      return;
    }
    const unsub = onSnapshot(
      collection(db, 'users', user.uid, 'readMarkers'),
      (snap) => {
        const next: Record<string, string> = {};
        snap.docs.forEach((d) => (next[d.id] = d.data().at));
        setReadMarkers(next);
      },
      (err) => console.error('Failed to load read markers:', err)
    );
    return unsub;
  }, [user?.uid]);

  // One tiny listener per circle (newest message only). Circles are small in
  // number, and this keeps circle chat's unread dot live without a field on
  // the circle doc that every member would need permission to write.
  const circleIdsKey = deps.myCircles.map((c) => c.id).sort().join(',');
  useEffect(() => {
    if (!user || !circleIdsKey) {
      setCircleLatest({});
      return;
    }
    const unsubs = circleIdsKey.split(',').map((circleId) =>
      onSnapshot(
        query(collection(db, 'circles', circleId, 'messages'), orderBy('createdAt', 'desc'), limit(1)),
        (snap) => {
          const latest = snap.docs[0]?.data();
          setCircleLatest((prev) => {
            const next = { ...prev };
            if (latest) next[circleId] = { at: latest.createdAt, fromUid: latest.fromUid };
            else delete next[circleId];
            return next;
          });
        },
        (err) => console.error('Failed to watch circle chat:', err)
      )
    );
    return () => unsubs.forEach((u) => u());
  }, [user?.uid, circleIdsKey]);

  const isDMThreadUnread = (t: DMThread) =>
    !!t.lastMessage &&
    !!t.lastMessageFromUid &&
    t.lastMessageFromUid !== user?.uid &&
    !blockedUids.has(t.otherUid) &&
    (!readMarkers[`dm_${t.id}`] || t.lastMessageAt > readMarkers[`dm_${t.id}`]);

  const isCircleChatUnread = (circleId: string) => {
    const latest = circleLatest[circleId];
    if (!latest || latest.fromUid === user?.uid || blockedUids.has(latest.fromUid)) return false;
    const marker = readMarkers[`circle_${circleId}`];
    return !marker || latest.at > marker;
  };

  const unreadDMCount = deps.dmThreads.filter(isDMThreadUnread).length;
  const unreadCircleCount = deps.myCircles.filter((c) => isCircleChatUnread(c.id)).length;

  /** The read marker as it was when a chat was opened -- for the "New messages" divider. */
  const readMarkerFor = (scope: ChatScope, containerId: string): string | undefined =>
    readMarkers[`${scope === 'dm' ? 'dm' : 'circle'}_${containerId}`];

  const lastMarkedRef = useRef<Record<string, string>>({});
  const markChatRead = (scope: ChatScope, containerId: string, at: string) => {
    if (!auth.currentUser || !at) return;
    const key = `${scope === 'dm' ? 'dm' : 'circle'}_${containerId}`;
    const current = lastMarkedRef.current[key] || readMarkers[key];
    if (current && current >= at) return;
    lastMarkedRef.current[key] = at;
    setDoc(doc(db, 'users', auth.currentUser.uid, 'readMarkers', key), { at }).catch((err) =>
      console.error('Failed to save read marker:', err)
    );
  };

  // Whatever chat is open is read up to its newest message.
  const newestDM = deps.activeDMMessages[deps.activeDMMessages.length - 1]?.createdAt;
  useEffect(() => {
    if (deps.activeDMThread && newestDM) markChatRead('dm', deps.activeDMThread.id, newestDM);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps.activeDMThread?.id, newestDM]);

  const newestCircle = deps.activeCircleMessages[deps.activeCircleMessages.length - 1]?.createdAt;
  useEffect(() => {
    if (deps.activeCircleChatId && newestCircle) markChatRead('circle', deps.activeCircleChatId, newestCircle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps.activeCircleChatId, newestCircle]);

  // ------------------------------------------------------- card answers
  const openChat: { scope: ChatScope; id: string } | null = deps.activeDMThread
    ? { scope: 'dm', id: deps.activeDMThread.id }
    : deps.activeCircleChatId
      ? { scope: 'circle', id: deps.activeCircleChatId }
      : null;
  const [responsesByMessageId, setResponsesByMessageId] = useState<Record<string, ChatResponse[]>>({});

  useEffect(() => {
    if (!openChat) {
      setResponsesByMessageId({});
      return;
    }
    const [col, id] = containerPath(openChat.scope, openChat.id);
    const unsub = onSnapshot(
      collection(db, col, id, 'responses'),
      (snap) => {
        const byMessage: Record<string, ChatResponse[]> = {};
        snap.docs.forEach((d) => {
          const r = { id: d.id, ...d.data() } as ChatResponse;
          (byMessage[r.messageId] ||= []).push(r);
        });
        setResponsesByMessageId(byMessage);
      },
      (err) => console.error('Failed to load chat card answers:', err)
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openChat?.scope, openChat?.id]);

  /** My answer to a request/quiz card. Works for any chat, not just the open one. */
  const respondToCard = async (
    scope: ChatScope,
    containerId: string,
    messageId: string,
    status: ChatResponse['status'],
    extra: { sharedRecordingId?: string; score?: number } = {}
  ) => {
    if (!auth.currentUser) return;
    const me = auth.currentUser.uid;
    const [col, id] = containerPath(scope, containerId);
    try {
      await setDoc(doc(db, col, id, 'responses', `${messageId}_${me}`), {
        messageId,
        uid: me,
        name: auth.currentUser.displayName || 'Someone',
        status,
        ...(extra.sharedRecordingId ? { sharedRecordingId: extra.sharedRecordingId } : {}),
        ...(typeof extra.score === 'number' ? { score: Math.round(extra.score) } : {}),
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `${col}/${id}/responses`);
      triggerToast("Couldn't save that. Try again.");
    }
  };

  return {
    blockedUsers,
    blockedUids,
    blockUser,
    unblockUser,
    reportContent,
    deleteChatMessage,
    guidelinesAcceptedAt,
    guidelinesPromptOpen,
    requireCommunityGuidelines,
    closeCommunityGuidelines,
    acceptCommunityGuidelines,
    isDMThreadUnread,
    isCircleChatUnread,
    unreadDMCount,
    unreadCircleCount,
    readMarkerFor,
    responsesByMessageId,
    respondToCard,
  };
}
