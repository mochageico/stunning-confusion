import { Dispatch, SetStateAction, useRef, useState } from 'react';
import { arrayUnion, collection, doc, getDoc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';

import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import type { ChatMessage, Recording } from '../types';
import {
  attachmentFallbackText,
  ChatAttachment,
  QuizAttachment,
  RecordingAttachment,
  RecordingRequestAttachment,
} from '../lib/chatAttachments';
import { stripUndefined } from '../lib/appData';
import type { ScreenName, TabName } from './useAppState';
import type { useSocial } from './useSocial';

// Split out of useAppState (see .claude/file-split-plan.md).

interface ChatCardsDeps {
  userRecordings: Recording[];
  feedRecordings: Recording[];
  setFeedRecordings: Dispatch<SetStateAction<Recording[]>>;
  setSelectedRecording: Dispatch<SetStateAction<Recording | null>>;
  navigateTo: (screen: ScreenName) => void;
  selectTab: (tab: TabName) => void;
  postChatMessage: (
    scope: 'dm' | 'circle',
    containerId: string,
    text: string,
    attachment?: ChatAttachment
  ) => Promise<boolean>;
  respondToCard: ReturnType<typeof useSocial>['respondToCard'];
  closeDMThread: () => void;
  closeCircleChat: () => void;
  /** Points the Record tab at a passage (a recording request's). */
  setRecordingPassage: (book: string, chapter: number, startVerse: number | null, endVerse: number | null) => void;
  triggerToast: (message: string) => void;
}

export function useChatCards({
  userRecordings,
  feedRecordings,
  setFeedRecordings,
  setSelectedRecording,
  navigateTo,
  selectTab,
  postChatMessage,
  respondToCard,
  closeDMThread,
  closeCircleChat,
  setRecordingPassage,
  triggerToast,
}: ChatCardsDeps) {
  // ==========================================
  // CHAT CARDS: sharing a recording into a chat, recording requests, quizzes
  // (see src/lib/chatAttachments.ts for the card shapes).
  // ==========================================

  /** Everyone in a chat except me: the other DM participant, or the circle's members. */
  const chatAudienceUids = async (scope: 'dm' | 'circle', containerId: string): Promise<string[]> => {
    const me = auth.currentUser?.uid;
    if (scope === 'dm') return containerId.split('_').filter((uid) => uid !== me);
    const snap = await getDocs(collection(db, 'circles', containerId, 'members'));
    return snap.docs.map((d) => d.id).filter((uid) => uid !== me);
  };

  /**
   * Makes one of my recordings playable by everyone in a chat, by adding
   * them to its sharedRecordings copy (creating a 'direct' copy if the
   * recording was private -- direct copies never show in anyone's feed).
   * Merge-write, so it works whether or not a shared copy already exists.
   */
  const shareRecordingInto = async (rec: Recording, scope: 'dm' | 'circle', containerId: string): Promise<boolean> => {
    if (!auth.currentUser) return false;
    const uid = auth.currentUser.uid;
    try {
      const audience = await chatAudienceUids(scope, containerId);
      const published = rec.sharedVisibility === 'circle' || rec.sharedVisibility === 'public';
      await setDoc(
        doc(db, 'sharedRecordings', rec.id),
        stripUndefined({
          ...rec,
          ownerId: uid,
          visibility: published ? rec.sharedVisibility : 'direct',
          sharedWithUids: arrayUnion(...audience),
          ...(published ? {} : { createdAt: serverTimestamp() }),
        }),
        { merge: true }
      );
      return true;
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, `sharedRecordings/${rec.id}`);
      triggerToast("Couldn't share that recording -- please try again.");
      return false;
    }
  };

  const sendRecordingToChat = async (rec: Recording, scope: 'dm' | 'circle', containerId: string) => {
    if (!rec.audioUrl) {
      triggerToast('That recording is still uploading.');
      return false;
    }
    if (!(await shareRecordingInto(rec, scope, containerId))) return false;
    const attachment: RecordingAttachment = {
      kind: 'recording',
      sharedRecordingId: rec.id,
      book: rec.book,
      chapter: rec.chapter,
      startVerse: rec.startVerse,
      endVerse: rec.endVerse,
      translation: rec.translation,
      duration: rec.duration,
      ownerName: auth.currentUser?.displayName || 'Someone',
    };
    return postChatMessage(scope, containerId, attachmentFallbackText(attachment, attachment.ownerName), attachment);
  };

  /** Opens a shared recording from a chat card in the normal player. */
  const playChatRecording = async (sharedRecordingId: string) => {
    const known = [...userRecordings, ...feedRecordings].find((r) => r.id === sharedRecordingId);
    if (known) {
      setSelectedRecording(known);
      navigateTo('recordingDetail');
      return;
    }
    try {
      const snap = await getDoc(doc(db, 'sharedRecordings', sharedRecordingId));
      if (!snap.exists()) {
        triggerToast('That recording was removed.');
        return;
      }
      const rec = { id: snap.id, ...snap.data() } as Recording;
      setFeedRecordings((prev) => (prev.some((r) => r.id === rec.id) ? prev : [rec, ...prev]));
      setSelectedRecording(rec);
      navigateTo('recordingDetail');
    } catch (err) {
      console.error('Failed to open shared recording:', err);
      triggerToast("You don't have access to that recording.");
    }
  };

  // The request I said "I will" to and am now recording for. Held in a ref
  // too, because persistRecording reads it from inside an async save.
  type ActiveRecordingRequest = {
    scope: 'dm' | 'circle';
    containerId: string;
    messageId: string;
    requesterName: string;
    attachment: RecordingRequestAttachment;
  };
  const [activeRecordingRequest, setActiveRecordingRequestState] = useState<ActiveRecordingRequest | null>(null);
  const activeRecordingRequestRef = useRef<ActiveRecordingRequest | null>(null);
  const setActiveRecordingRequest = (req: ActiveRecordingRequest | null) => {
    activeRecordingRequestRef.current = req;
    setActiveRecordingRequestState(req);
  };

  /** "I will": point the Record tab at the requested passage and go there. */
  const startRecordingForRequest = (scope: 'dm' | 'circle', containerId: string, message: ChatMessage) => {
    const a = message.attachment;
    if (!a || a.kind !== 'recordingRequest') return;
    void respondToCard(scope, containerId, message.id, 'willDo');
    setRecordingPassage(a.book, a.chapter, a.startVerse ?? null, a.endVerse ?? a.startVerse ?? null);
    setActiveRecordingRequest({ scope, containerId, messageId: message.id, requesterName: message.fromName, attachment: a });
    if (scope === 'dm') closeDMThread();
    else closeCircleChat();
    selectTab('record');
  };

  const cancelRecordingRequest = () => setActiveRecordingRequest(null);

  const fulfillRecordingRequest = async (rec: Recording) => {
    const req = activeRecordingRequestRef.current;
    if (!req) return;
    // Only a recording of the asked-for chapter counts; anything else is
    // just a normal save and the request stays open.
    if (rec.book.toLowerCase() !== req.attachment.book.toLowerCase() || rec.chapter !== req.attachment.chapter) return;
    setActiveRecordingRequest(null);
    const sent = await sendRecordingToChat(rec, req.scope, req.containerId);
    if (!sent) return;
    await respondToCard(req.scope, req.containerId, req.messageId, 'done', { sharedRecordingId: rec.id });
    triggerToast(`Sent to ${req.scope === 'dm' ? req.requesterName : 'the circle'}.`);
  };

  // Quizzes: the friend's shared verse list (only exists if they share it
  // with friends) and whichever quiz I'm taking right now.
  const loadFriendQuizVerses = async (friendUid: string) => {
    try {
      const snap = await getDoc(doc(db, 'profiles', friendUid, 'shared', 'memoryQueue'));
      if (!snap.exists()) return null;
      const items = (snap.data().items || []) as Array<{
        book: string;
        chapter: number;
        verseNumber: number;
        status: string;
        translationId?: string;
      }>;
      // Only verses they've actually started -- you can't quiz someone on a
      // verse still waiting in their queue.
      return items.filter((i) => i.status !== 'queued');
    } catch {
      return null;
    }
  };

  const [activeQuiz, setActiveQuiz] = useState<{
    threadId: string;
    messageId: string;
    fromName: string;
    attachment: QuizAttachment;
  } | null>(null);

  const openQuiz = (threadId: string, message: ChatMessage) => {
    const a = message.attachment;
    if (!a || a.kind !== 'quiz') return;
    setActiveQuiz({ threadId, messageId: message.id, fromName: message.fromName, attachment: a });
    navigateTo('quiz');
  };

  /** Records the score on the quiz card. Practice only -- never touches the review schedule. */
  const finishQuiz = async (score: number) => {
    if (!activeQuiz) return;
    await respondToCard('dm', activeQuiz.threadId, activeQuiz.messageId, 'done', { score });
  };

  const closeQuiz = () => setActiveQuiz(null);

  return {
    sendRecordingToChat,
    playChatRecording,
    activeRecordingRequest,
    startRecordingForRequest,
    cancelRecordingRequest,
    fulfillRecordingRequest,
    loadFriendQuizVerses,
    activeQuiz,
    openQuiz,
    finishQuiz,
    closeQuiz,
  };
}
