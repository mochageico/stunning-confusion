import { useState } from 'react';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';

import { auth, db, handleFirestoreError, OperationType } from '../firebase';
import type { AccountabilityNudge, Friend } from '../types';
import { getLogicalDate, localDayKey } from '../lib/logicalDate';

// Split out of useAppState (see .claude/file-split-plan.md).

// Default cap on accountability nudges a user will receive per logical day
// (from any friend, combined) before senders are told they've hit it —
// applies unless the recipient has set UserProfile.accountabilityDailyCap.
const ACCOUNTABILITY_DEFAULT_DAILY_CAP = 5;
// Mirrored in firestore.rules (accountabilityNudges) -- change both together.
const NUDGE_MAX_CHARS = 500;

interface AccountabilityNudgesDeps {
  friends: Friend[];
  dayStartHour: number;
  triggerToast: (message: string) => void;
}

export function useAccountabilityNudges({ friends, dayStartHour, triggerToast }: AccountabilityNudgesDeps) {
  // Accountability nudges -- see AccountabilityNudge in types.ts. Own daily
  // received cap defaults to ACCOUNTABILITY_DEFAULT_DAILY_CAP until loaded
  // from profiles/{uid}.accountabilityDailyCap in loadUserData.
  const [accountabilityDailyCap, setAccountabilityDailyCapState] = useState<number>(ACCOUNTABILITY_DEFAULT_DAILY_CAP);
  // My own private "when did I last nudge this friend" log -- keyed by friendUid.
  const [accountabilitySentLog, setAccountabilitySentLog] = useState<Record<string, string>>({});
  const [receivedAccountabilityNudges, setReceivedAccountabilityNudges] = useState<AccountabilityNudge[]>([]);
  const [loadingAccountabilityNudges, setLoadingAccountabilityNudges] = useState(false);

  // ==========================================
  // ACCOUNTABILITY NUDGES -- friend-only, custom-message notification,
  // deliberately separate from any messaging/DM system. Two independent
  // daily limits, both keyed to the current user's dayStartHour setting:
  //   - Sender: at most 1 nudge to a given friend per logical day (hard,
  //     not configurable) -- enforced via canSendAccountabilityNudge below,
  //     which the UI uses to grey out the button before a tap is even
  //     attempted.
  //   - Receiver: a configurable daily cap (any sender combined), checked
  //     at send time against profiles/{toUid}.accountabilityDailyCap and
  //     profiles/{toUid}/accountabilityMeta/counter.
  // No Cloud Functions in this project (see firestore.rules comment on the
  // counter doc) -- this is read-then-write from the sender's client, same
  // "reasonable trust, not airtight" posture as the rest of the app. The
  // counter's day-rollover uses the SENDER's own logical day as a stand-in
  // for the receiver's, a deliberate simplification (the two would only
  // disagree for a few hours around midnight if their dayStartHour settings
  // differ), rather than plumbing the receiver's private setting to the
  // sender's client just for this.
  // ==========================================
  const loadAccountabilitySentLog = async () => {
    if (!auth.currentUser) {
      setAccountabilitySentLog({});
      return;
    }
    try {
      const snap = await getDocs(collection(db, 'profiles', auth.currentUser.uid, 'accountabilitySentLog'));
      const log: Record<string, string> = {};
      snap.docs.forEach((d) => {
        log[d.id] = (d.data().lastSentAt as string) || '';
      });
      setAccountabilitySentLog(log);
    } catch (err) {
      console.error('Failed to load accountability sent log:', err);
    }
  };

  const loadReceivedAccountabilityNudges = async () => {
    if (!auth.currentUser) {
      setReceivedAccountabilityNudges([]);
      return;
    }
    setLoadingAccountabilityNudges(true);
    try {
      const snap = await getDocs(
        query(collection(db, 'accountabilityNudges'), where('toUid', '==', auth.currentUser.uid), orderBy('createdAt', 'desc'), limit(50))
      );
      setReceivedAccountabilityNudges(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as AccountabilityNudge));
    } catch (err) {
      console.error('Failed to load accountability nudges:', err);
    } finally {
      setLoadingAccountabilityNudges(false);
    }
  };

  // Pure/cheap -- the UI calls this to decide whether a friend's nudge
  // button is greyed out, without any Firestore round-trip.
  const canSendAccountabilityNudge = (friendUid: string): boolean => {
    const lastSentAt = accountabilitySentLog[friendUid];
    if (!lastSentAt) return true;
    return localDayKey(getLogicalDate(dayStartHour, new Date(lastSentAt))) !== localDayKey(getLogicalDate(dayStartHour));
  };

  const sendAccountabilityNudge = async (friend: Friend, message: string) => {
    if (!auth.currentUser) return;
    const myUid = auth.currentUser.uid;
    if (!friends.some((f) => f.uid === friend.uid)) {
      triggerToast('You can only send accountability nudges to friends.');
      return;
    }
    if (!canSendAccountabilityNudge(friend.uid)) {
      triggerToast(`Accountability notification already sent for today -- you can send another tomorrow!`);
      return;
    }
    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
      triggerToast('Write a quick message before sending.');
      return;
    }
    // Same cap firestore.rules enforces on accountabilityNudges.
    if (trimmedMessage.length > NUDGE_MAX_CHARS) {
      triggerToast(`Keep nudges under ${NUDGE_MAX_CHARS} characters.`);
      return;
    }
    try {
      const todayKey = localDayKey(getLogicalDate(dayStartHour));
      const counterRef = doc(db, 'profiles', friend.uid, 'accountabilityMeta', 'counter');
      const [counterSnap, friendProfileSnap] = await Promise.all([getDoc(counterRef), getDoc(doc(db, 'profiles', friend.uid))]);

      if (friendProfileSnap.data()?.isPaused) {
        triggerToast(`${friend.displayName} is on a break right now -- accountability nudges are paused until they're back.`);
        return;
      }

      const cap = (friendProfileSnap.data()?.accountabilityDailyCap as number) ?? ACCOUNTABILITY_DEFAULT_DAILY_CAP;
      const counterData = counterSnap.data() as { dateKey?: string; count?: number } | undefined;
      const isSameDay = counterData?.dateKey === todayKey;
      const countSoFar = isSameDay ? counterData?.count || 0 : 0;

      if (isSameDay && countSoFar >= cap) {
        triggerToast(`${friend.displayName} has reached their daily accountability-notification limit -- try again tomorrow.`);
        return;
      }

      if (isSameDay) {
        await updateDoc(counterRef, { count: increment(1), dateKey: todayKey });
      } else {
        await setDoc(counterRef, { count: 1, dateKey: todayKey });
      }

      const nowISO = new Date().toISOString();
      await addDoc(collection(db, 'accountabilityNudges'), {
        fromUid: myUid,
        fromName: auth.currentUser.displayName || 'Anonymous Disciple',
        fromAvatarUrl: '',
        toUid: friend.uid,
        message: trimmedMessage,
        createdAt: nowISO,
        read: false,
      });
      await setDoc(doc(db, 'profiles', myUid, 'accountabilitySentLog', friend.uid), { lastSentAt: nowISO });

      setAccountabilitySentLog((prev) => ({ ...prev, [friend.uid]: nowISO }));
      triggerToast(`Nudge sent to ${friend.displayName}.`);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'accountabilityNudges');
      triggerToast('Could not send that nudge -- please try again.');
    }
  };

  const markAccountabilityNudgeRead = async (nudgeId: string) => {
    setReceivedAccountabilityNudges((prev) => prev.map((n) => (n.id === nudgeId ? { ...n, read: true } : n)));
    try {
      await updateDoc(doc(db, 'accountabilityNudges', nudgeId), { read: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `accountabilityNudges/${nudgeId}`);
    }
  };

  const dismissAccountabilityNudge = async (nudgeId: string) => {
    setReceivedAccountabilityNudges((prev) => prev.filter((n) => n.id !== nudgeId));
    try {
      await deleteDoc(doc(db, 'accountabilityNudges', nudgeId));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `accountabilityNudges/${nudgeId}`);
    }
  };

  const updateAccountabilityDailyCap = async (cap: number) => {
    setAccountabilityDailyCapState(cap);
    if (!auth.currentUser) return;
    try {
      await setDoc(doc(db, 'profiles', auth.currentUser.uid), { accountabilityDailyCap: cap }, { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `profiles/${auth.currentUser.uid}`);
    }
  };

  /** Your own cap from your profile doc (loadUserData). Missing means the default. */
  const applyAccountabilityDailyCap = (cap: number | undefined) => {
    setAccountabilityDailyCapState(cap ?? ACCOUNTABILITY_DEFAULT_DAILY_CAP);
  };

  /** Back to a signed-out blank slate. */
  const resetAccountabilityNudges = () => {
    setAccountabilityDailyCapState(ACCOUNTABILITY_DEFAULT_DAILY_CAP);
    setAccountabilitySentLog({});
    setReceivedAccountabilityNudges([]);
  };

  return {
    accountabilityDailyCap,
    receivedAccountabilityNudges,
    loadingAccountabilityNudges,
    loadAccountabilitySentLog,
    loadReceivedAccountabilityNudges,
    canSendAccountabilityNudge,
    sendAccountabilityNudge,
    markAccountabilityNudgeRead,
    dismissAccountabilityNudge,
    updateAccountabilityDailyCap,
    applyAccountabilityDailyCap,
    resetAccountabilityNudges,
  };
}
