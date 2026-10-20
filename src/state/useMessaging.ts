import { useEffect, useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import type { ChatMessage, Circle, DMThread, Friend, MessageReaction } from '../types';
import { ChatAttachment, cleanAttachment } from '../lib/chatAttachments';
import type { ScreenName } from './useAppState';

// Split out of useAppState (see .claude/file-split-plan.md).

// Mirrored in firestore.rules (isValidMessageText) -- change both together.
const CHAT_MESSAGE_MAX_CHARS = 2000;

interface MessagingDeps {
  user: { uid: string } | null;
  friends: Friend[];
  myCircles: Circle[];
  navigateTo: (screen: ScreenName) => void;
  triggerToast: (message: string) => void;
}

export function useMessaging({ user, friends, myCircles, navigateTo, triggerToast }: MessagingDeps) {
  // Messaging: DM inbox (dmThreads) + whichever thread/circle chat is
  // currently open. Both message lists are live (onSnapshot), unlike the
  // rest of this app's one-shot getDocs loads -- chat is the one place a
  // stale view actually matters.
  const [dmThreads, setDmThreads] = useState<DMThread[]>([]);
  const [loadingDmThreads, setLoadingDmThreads] = useState(false);
  const [activeDMThread, setActiveDMThread] = useState<DMThread | null>(null);
  const [activeDMMessages, setActiveDMMessages] = useState<ChatMessage[]>([]);
  const [loadingActiveDMMessages, setLoadingActiveDMMessages] = useState(false);
  const [activeCircleChatId, setActiveCircleChatId] = useState<string | null>(null);
  const [activeCircleMessages, setActiveCircleMessages] = useState<ChatMessage[]>([]);
  const [loadingActiveCircleMessages, setLoadingActiveCircleMessages] = useState(false);

  // Reactions -- one live listener per open chat surface (DM thread OR
  // circle chat), keyed by the same id the messages listener uses, so a
  // chat screen never needs more than its one existing messages listener
  // plus this one. See MessageReaction in types.ts.
  const [reactionsByMessageId, setReactionsByMessageId] = useState<Record<string, MessageReaction[]>>({});

  // ==========================================
  // MESSAGING -- DM threads (friend OR shared-circle gated, re-checked
  // server-side on every send) and per-circle group chat. Both message lists
  // are live (onSnapshot) rather than this app's usual one-shot getDocs --
  // chat is the one place a stale view actually matters, and there's no
  // Cloud Functions/push infra to notify otherwise.
  // ==========================================

  // Whichever friend/circle relationship justified opening the DM is
  // re-verified every render against live friends/myCircles + the circles
  // verified (by real member docs) at open time to contain both people --
  // purely a UI hint for the read-only banner; the real enforcement is the
  // Firestore rule re-checking dmGated() on every message create, so this
  // can never be used to bypass anything even if it drifts stale.
  const [activeDMSharedCircleIds, setActiveDMSharedCircleIds] = useState<string[]>([]);
  const activeDMThreadActive =
    !!activeDMThread &&
    (friends.some((f) => f.uid === activeDMThread.otherUid) ||
      myCircles.some((c) => activeDMSharedCircleIds.includes(c.id)));

  // Which of MY circles the other person is really in, checked against each
  // circle's member list (readable to me as a member) rather than their
  // self-written profile circleIds, which the rules no longer trust.
  const findSharedCircleIds = async (otherUid: string): Promise<string[]> => {
    const checks = await Promise.all(
      myCircles.map((c) =>
        getDoc(doc(db, 'circles', c.id, 'members', otherUid))
          .then((s) => (s.exists() ? c.id : null))
          .catch(() => null)
      )
    );
    return checks.filter((id): id is string => id !== null);
  };

  const openDMThread = async (otherUid: string, otherName: string, otherAvatarUrl: string) => {
    if (!auth.currentUser || otherUid === auth.currentUser.uid) return;
    const myUid = auth.currentUser.uid;
    const threadId = [myUid, otherUid].sort().join('_');
    const threadRef = doc(db, 'dmThreads', threadId);
    try {
      const [threadSnap, sharedCircleIds] = await Promise.all([getDoc(threadRef), findSharedCircleIds(otherUid)]);
      const isFriend = friends.some((f) => f.uid === otherUid);

      let data = threadSnap.data();
      if (!data) {
        if (!isFriend && sharedCircleIds.length === 0) {
          triggerToast('You can only message friends or people who share a community with you.');
          return;
        }
        const nowISO = new Date().toISOString();
        const myName = auth.currentUser.displayName || 'Anonymous Disciple';
        data = {
          participantUids: [myUid, otherUid].sort(),
          participantNames: { [myUid]: myName, [otherUid]: otherName },
          participantAvatars: { [myUid]: auth.currentUser.photoURL || '', [otherUid]: otherAvatarUrl },
          lastMessage: '',
          lastMessageAt: nowISO,
          createdAt: nowISO,
          // The rules can only check ONE circle per thread (no loops), so
          // record the one we verified. Friends need none.
          ...(sharedCircleIds.length > 0 ? { viaCircleId: sharedCircleIds[0] } : {}),
        };
        await setDoc(threadRef, data);
      } else if (sharedCircleIds.length > 0 && !sharedCircleIds.includes(data.viaCircleId)) {
        // The circle this thread was opened through may have been left or
        // disbanded while the two still share another -- re-point it so the
        // thread doesn't go read-only for no reason. Best effort: if it
        // fails, friendship (if any) still gates the thread on its own.
        const viaCircleId = sharedCircleIds[0];
        try {
          await updateDoc(threadRef, { viaCircleId });
          data = { ...data, viaCircleId };
        } catch (err) {
          console.error('Failed to re-point DM thread circle:', err);
        }
      }

      setActiveDMSharedCircleIds(sharedCircleIds);
      setActiveDMThread({
        id: threadId,
        participantUids: data.participantUids,
        otherUid,
        otherName: data.participantNames?.[otherUid] || otherName,
        otherAvatarUrl: data.participantAvatars?.[otherUid] || otherAvatarUrl,
        lastMessage: data.lastMessage || '',
        lastMessageAt: data.lastMessageAt,
        createdAt: data.createdAt,
      });
      navigateTo('dmThread');
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `dmThreads/${threadId}`);
      triggerToast("Couldn't open that conversation -- please try again.");
    }
  };

  const closeDMThread = () => {
    setActiveDMThread(null);
    setActiveDMMessages([]);
    setActiveDMSharedCircleIds([]);
  };

  /**
   * Posts to any chat -- not only the open one -- so a recording made for a
   * request can be delivered back into the conversation it was asked in.
   * `attachment` is an optional card (src/lib/chatAttachments.ts); `text`
   * is always its readable fallback.
   */
  const postChatMessage = async (
    scope: 'dm' | 'circle',
    containerId: string,
    text: string,
    attachment?: ChatAttachment
  ): Promise<boolean> => {
    if (!auth.currentUser) return false;
    const trimmed = text.trim();
    if (!trimmed) return false;
    if (trimmed.length > CHAT_MESSAGE_MAX_CHARS) {
      triggerToast(`Messages can be up to ${CHAT_MESSAGE_MAX_CHARS} characters.`);
      return false;
    }
    const nowISO = new Date().toISOString();
    const message = {
      fromUid: auth.currentUser.uid,
      fromName: auth.currentUser.displayName || 'Anonymous Disciple',
      fromAvatarUrl: auth.currentUser.photoURL || '',
      text: trimmed,
      createdAt: nowISO,
      ...(attachment ? { attachment: cleanAttachment(attachment) } : {}),
    };
    try {
      if (scope === 'dm') {
        await addDoc(collection(db, 'dmThreads', containerId, 'messages'), message);
        await updateDoc(doc(db, 'dmThreads', containerId), {
          lastMessage: trimmed,
          lastMessageAt: nowISO,
          lastMessageFromUid: auth.currentUser.uid,
        });
      } else {
        await addDoc(collection(db, 'circles', containerId, 'messages'), message);
      }
      return true;
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, `${scope === 'dm' ? 'dmThreads' : 'circles'}/${containerId}/messages`);
      triggerToast(
        scope === 'dm'
          ? "This can't be sent -- you're no longer connected. Send a friend request to keep the conversation going."
          : "Couldn't send that message -- please try again."
      );
      return false;
    }
  };

  const sendDMMessage = async (text: string, attachment?: ChatAttachment) => {
    if (!activeDMThread) return false;
    return postChatMessage('dm', activeDMThread.id, text, attachment);
  };

  // ==========================================
  // MESSAGE REACTIONS -- see MessageReaction in types.ts. One reaction per
  // user per message; the doc id (`${messageId}_${uid}`) is what enforces
  // that both client-side (this function) and in firestore.rules. Tapping
  // an emoji I've already reacted with removes it; tapping a different one
  // replaces it (delete + create, matching the rule's `update: if false`).
  // ==========================================

  const toggleReaction = async (
    scope: 'dm' | 'circle',
    containerId: string,
    messageId: string,
    emoji: string
  ) => {
    if (!auth.currentUser) return;
    const myUid = auth.currentUser.uid;
    const reactionRef = doc(
      db,
      scope === 'dm' ? 'dmThreads' : 'circles',
      containerId,
      'reactions',
      `${messageId}_${myUid}`
    );
    const existing = reactionsByMessageId[messageId]?.find((r) => r.uid === myUid);
    try {
      if (existing?.emoji === emoji) {
        await deleteDoc(reactionRef);
        return;
      }
      if (existing) {
        await deleteDoc(reactionRef);
      }
      await setDoc(reactionRef, {
        messageId,
        uid: myUid,
        name: auth.currentUser.displayName || 'Anonymous Disciple',
        emoji,
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `${scope === 'dm' ? 'dmThreads' : 'circles'}/${containerId}/reactions`);
    }
  };

  const openCircleChat = (circleId: string) => {
    setActiveCircleChatId(circleId);
    navigateTo('circleChat');
  };

  const closeCircleChat = () => {
    setActiveCircleChatId(null);
    setActiveCircleMessages([]);
  };

  const sendCircleMessage = async (text: string, attachment?: ChatAttachment) => {
    if (!activeCircleChatId) return false;
    return postChatMessage('circle', activeCircleChatId, text, attachment);
  };

  // Live DM inbox -- reloads automatically on sign-in/out.
  useEffect(() => {
    if (!user) {
      setDmThreads([]);
      return;
    }
    setLoadingDmThreads(true);
    const q = query(
      collection(db, 'dmThreads'),
      where('participantUids', 'array-contains', user.uid),
      orderBy('lastMessageAt', 'desc'),
      limit(50)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setDmThreads(
          snap.docs.map((d) => {
            const data = d.data();
            const otherUid = ((data.participantUids as string[]) || []).find((uid) => uid !== user.uid) || '';
            return {
              id: d.id,
              participantUids: data.participantUids,
              otherUid,
              otherName: data.participantNames?.[otherUid] || 'Someone',
              otherAvatarUrl: data.participantAvatars?.[otherUid] || '',
              lastMessage: data.lastMessage || '',
              lastMessageAt: data.lastMessageAt,
              lastMessageFromUid: data.lastMessageFromUid,
              createdAt: data.createdAt,
            } as DMThread;
          })
        );
        setLoadingDmThreads(false);
      },
      (err) => {
        console.error('Failed to load DM threads:', err);
        setLoadingDmThreads(false);
      }
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Live messages for whichever DM thread is currently open.
  useEffect(() => {
    if (!activeDMThread) {
      setActiveDMMessages([]);
      return;
    }
    setLoadingActiveDMMessages(true);
    const q = query(collection(db, 'dmThreads', activeDMThread.id, 'messages'), orderBy('createdAt', 'asc'), limit(200));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setActiveDMMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ChatMessage));
        setLoadingActiveDMMessages(false);
      },
      (err) => {
        console.error('Failed to load DM messages:', err);
        setLoadingActiveDMMessages(false);
      }
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDMThread?.id]);

  // Live reactions for whichever DM thread is currently open -- grouped by
  // messageId (a single flat query, not one listener per message). Shares
  // reactionsByMessageId with the circle-chat reactions listener below since
  // dmThread/circleChat are mutually exclusive screens, never open at once.
  useEffect(() => {
    if (!activeDMThread) {
      setReactionsByMessageId({});
      return;
    }
    const q = query(collection(db, 'dmThreads', activeDMThread.id, 'reactions'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const byMessage: Record<string, MessageReaction[]> = {};
        snap.docs.forEach((d) => {
          const reaction = { id: d.id, ...d.data() } as MessageReaction;
          (byMessage[reaction.messageId] ||= []).push(reaction);
        });
        setReactionsByMessageId(byMessage);
      },
      (err) => console.error('Failed to load DM reactions:', err)
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeDMThread?.id]);

  // Live messages for whichever circle's group chat is currently open.
  useEffect(() => {
    if (!activeCircleChatId) {
      setActiveCircleMessages([]);
      return;
    }
    setLoadingActiveCircleMessages(true);
    const q = query(collection(db, 'circles', activeCircleChatId, 'messages'), orderBy('createdAt', 'asc'), limit(200));
    const unsub = onSnapshot(
      q,
      (snap) => {
        setActiveCircleMessages(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ChatMessage));
        setLoadingActiveCircleMessages(false);
      },
      (err) => {
        console.error('Failed to load circle chat messages:', err);
        setLoadingActiveCircleMessages(false);
      }
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCircleChatId]);

  // Live reactions for whichever circle chat is currently open -- mirrors
  // the DM reactions listener above, same shared reactionsByMessageId state.
  useEffect(() => {
    if (!activeCircleChatId) {
      setReactionsByMessageId({});
      return;
    }
    const q = query(collection(db, 'circles', activeCircleChatId, 'reactions'));
    const unsub = onSnapshot(
      q,
      (snap) => {
        const byMessage: Record<string, MessageReaction[]> = {};
        snap.docs.forEach((d) => {
          const reaction = { id: d.id, ...d.data() } as MessageReaction;
          (byMessage[reaction.messageId] ||= []).push(reaction);
        });
        setReactionsByMessageId(byMessage);
      },
      (err) => console.error('Failed to load circle chat reactions:', err)
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCircleChatId]);

  return {
    dmThreads,
    loadingDmThreads,
    activeDMThread,
    activeDMMessages,
    loadingActiveDMMessages,
    activeCircleChatId,
    activeCircleMessages,
    loadingActiveCircleMessages,
    reactionsByMessageId,
    activeDMThreadActive,
    findSharedCircleIds,
    openDMThread,
    closeDMThread,
    postChatMessage,
    sendDMMessage,
    toggleReaction,
    openCircleChat,
    closeCircleChat,
    sendCircleMessage,
  };
}
