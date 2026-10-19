// ============================================================================
// SOCIAL PUSH NOTIFICATIONS
// ----------------------------------------------------------------------------
// Firestore triggers that turn social events into phone notifications, sent
// through Expo's push service to the tokens each app saves under
// users/{uid}/pushTokens (see src/state/usePushNotifications.ts):
//
//   new DM message            -> the other person          (pref: messages)
//   new circle message        -> every other member        (pref: circleChat, per-circle mute)
//   friend request            -> the person asked          (pref: friendActivity)
//   nudge                     -> the friend nudged         (pref: friendActivity)
//   race challenge / accept   -> the other racer           (pref: friendActivity)
//   "I will" on a request,
//   or a quiz score           -> whoever sent the card     (pref: friendActivity)
//   moderation report         -> the app's admins (ADMIN_UIDS)
//
// Every send honours the recipient's switches in users/{uid}/settings/
// notifications and skips anyone who has blocked the sender. Triggers run in
// us-east1 because that's where the app's Firestore database lives -- a
// Firestore trigger must be in its database's region.
// ============================================================================

import { getFirestore } from 'firebase-admin/firestore';
import { onDocumentCreated, onDocumentWritten } from 'firebase-functions/v2/firestore';
import { defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions';

// Same named database as index.ts -- getFirestore() alone would silently use
// the empty (default) one.
const FIRESTORE_DATABASE_ID = 'ai-studio-da1c3045-26bb-470c-883c-0b120417bcda';
const REGION = 'us-east1';
const TRIGGER = { database: FIRESTORE_DATABASE_ID, region: REGION } as const;

/** Comma-separated uids that get a push for every new report. Set with `firebase functions:config` / .env. */
const ADMIN_UIDS = defineString('ADMIN_UIDS', { default: '' });

const db = () => getFirestore(FIRESTORE_DATABASE_ID);

type PrefKey = 'messages' | 'circleChat' | 'friendActivity';

interface Push {
  title: string;
  body: string;
  /** Opened in the app on tap (see PushTarget in usePushNotifications.ts). */
  target: Record<string, string>;
  /** 'dm_<id>' / 'circle_<id>': no banner while that chat is on screen. */
  chatKey?: string;
}

const clip = (text: string, max = 140) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

const passage = (a: { book?: string; chapter?: number; startVerse?: number; endVerse?: number; verse?: number }) => {
  const start = a.startVerse ?? a.verse;
  if (start === undefined) return `${a.book} ${a.chapter}`;
  const end = a.endVerse ?? start;
  return `${a.book} ${a.chapter}:${start}${end !== start ? `-${end}` : ''}`;
};

async function wantsIt(uid: string, pref: PrefKey | null, fromUid: string | null, circleId?: string): Promise<boolean> {
  const [settings, blocked] = await Promise.all([
    db().doc(`users/${uid}/settings/notifications`).get(),
    fromUid ? db().doc(`profiles/${uid}/blocked/${fromUid}`).get() : Promise.resolve(null),
  ]);
  if (blocked?.exists) return false;
  const s = settings.data() || {};
  if (pref && s[pref] === false) return false;
  if (circleId && Array.isArray(s.mutedCircleIds) && s.mutedCircleIds.includes(circleId)) return false;
  return true;
}

/** Sends one notification to each uid's devices; prunes tokens Expo says are dead. */
async function sendPush(uids: string[], push: Push, pref: PrefKey | null, fromUid: string | null, circleId?: string) {
  const recipients = (
    await Promise.all(uids.map(async (uid) => ((await wantsIt(uid, pref, fromUid, circleId)) ? uid : null)))
  ).filter((u): u is string => !!u);
  if (recipients.length === 0) return;

  const tokenDocs = (await Promise.all(recipients.map((uid) => db().collection(`users/${uid}/pushTokens`).get()))).flatMap((s) => s.docs);
  const messages = tokenDocs
    .map((d) => ({ ref: d.ref, token: d.data().token as string }))
    .filter((t) => typeof t.token === 'string' && t.token.startsWith('ExponentPushToken'));
  if (messages.length === 0) return;

  for (let i = 0; i < messages.length; i += 100) {
    const chunk = messages.slice(i, i + 100);
    try {
      const res = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(
          chunk.map((m) => ({
            to: m.token,
            title: push.title,
            body: push.body,
            sound: 'default',
            channelId: 'default',
            data: { target: push.target, ...(push.chatKey ? { chatKey: push.chatKey } : {}) },
          }))
        ),
      });
      const json = (await res.json()) as { data?: Array<{ status: string; details?: { error?: string } }> };
      await Promise.all(
        (json.data || []).map((ticket, k) =>
          ticket.status === 'error' && ticket.details?.error === 'DeviceNotRegistered' ? chunk[k].ref.delete() : null
        )
      );
    } catch (err) {
      logger.error('Expo push failed', err);
    }
  }
}

// ---------------------------------------------------------------- messages

export const notifyDmMessage = onDocumentCreated({ ...TRIGGER, document: 'dmThreads/{threadId}/messages/{messageId}' }, async (event) => {
  const msg = event.data?.data();
  if (!msg) return;
  const threadId = event.params.threadId;
  const toUid = threadId.split('_').find((uid) => uid !== msg.fromUid);
  if (!toUid) return;
  await sendPush(
    [toUid],
    {
      title: msg.fromName || 'New message',
      body: clip(msg.text || ''),
      target: { type: 'dm', threadId, otherUid: msg.fromUid, otherName: msg.fromName || '' },
      chatKey: `dm_${threadId}`,
    },
    'messages',
    msg.fromUid
  );
});

export const notifyCircleMessage = onDocumentCreated({ ...TRIGGER, document: 'circles/{circleId}/messages/{messageId}' }, async (event) => {
  const msg = event.data?.data();
  if (!msg) return;
  const circleId = event.params.circleId;
  const [circle, members] = await Promise.all([db().doc(`circles/${circleId}`).get(), db().collection(`circles/${circleId}/members`).get()]);
  const uids = members.docs.map((d) => d.id).filter((uid) => uid !== msg.fromUid);
  await sendPush(
    uids,
    {
      title: circle.data()?.name || 'Your circle',
      body: clip(`${msg.fromName || 'Someone'}: ${msg.text || ''}`),
      target: { type: 'circle', circleId },
      chatKey: `circle_${circleId}`,
    },
    'circleChat',
    msg.fromUid,
    circleId
  );
});

// ---------------------------------------------------------------- friends

// Written, not created: re-sending over an old declined request is an update
// back to 'pending', and that should notify too.
export const notifyFriendRequest = onDocumentWritten({ ...TRIGGER, document: 'friendRequests/{requestId}' }, async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!after) return;
  if (after.status === 'pending' && before?.status !== 'pending') {
    await sendPush([after.toUid], { title: 'Friend request', body: `${after.fromName || 'Someone'} wants to be friends.`, target: { type: 'friendRequest' } }, 'friendActivity', after.fromUid);
  }
});

export const notifyNudge = onDocumentCreated({ ...TRIGGER, document: 'accountabilityNudges/{nudgeId}' }, async (event) => {
  const n = event.data?.data();
  if (!n) return;
  await sendPush([n.toUid], { title: `${n.fromName || 'A friend'} nudged you`, body: clip(n.message || ''), target: { type: 'nudge' } }, 'friendActivity', n.fromUid);
});

export const notifyChallenge = onDocumentWritten({ ...TRIGGER, document: 'challenges/{challengeId}' }, async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!after) return;
  const ref = after.startChapter === after.endChapter ? passage({ book: after.book, chapter: after.startChapter, startVerse: after.startVerse, endVerse: after.endVerse }) : `${after.book} ${after.startChapter}-${after.endChapter}`;
  if (!before && after.status === 'pending') {
    await sendPush(
      [after.toUid],
      { title: `${after.fromName} challenged you`, body: `Race to memorize ${ref}.`, target: { type: 'dm', threadId: after.dmThreadId, otherUid: after.fromUid, otherName: after.fromName }, chatKey: `dm_${after.dmThreadId}` },
      'friendActivity',
      after.fromUid
    );
  } else if (before?.status === 'pending' && after.status === 'active') {
    await sendPush(
      [after.fromUid],
      { title: `${after.toName} accepted your race`, body: `${ref} -- you're both off.`, target: { type: 'dm', threadId: after.dmThreadId, otherUid: after.toUid, otherName: after.toName }, chatKey: `dm_${after.dmThreadId}` },
      'friendActivity',
      after.toUid
    );
  }
});

// ------------------------------------------------- answers to chat cards

async function notifyCardAnswer(scope: 'dm' | 'circle', containerId: string, before: FirebaseFirestore.DocumentData | undefined, after: FirebaseFirestore.DocumentData | undefined) {
  if (!after || before?.status === after.status) return;
  const col = scope === 'dm' ? 'dmThreads' : 'circles';
  const message = (await db().doc(`${col}/${containerId}/messages/${after.messageId}`).get()).data();
  const a = message?.attachment;
  if (!message || !a || message.fromUid === after.uid) return;
  const target: Record<string, string> =
    scope === 'dm'
      ? { type: 'dm', threadId: containerId, otherUid: after.uid, otherName: after.name || '' }
      : { type: 'circle', circleId: containerId };
  const chatKey = `${scope}_${containerId}`;
  if (a.kind === 'recordingRequest' && after.status === 'willDo') {
    await sendPush([message.fromUid], { title: `${after.name} will record it`, body: `${passage(a)} -- they said "I will".`, target, chatKey }, 'friendActivity', after.uid);
  } else if (a.kind === 'quiz' && after.status === 'done' && typeof after.score === 'number') {
    await sendPush([message.fromUid], { title: `${after.name} took your quiz`, body: `${after.score}% on ${passage(a)}.`, target, chatKey }, 'friendActivity', after.uid);
  }
  // A finished recording arrives as its own chat message, which notifies.
}

export const notifyDmCardAnswer = onDocumentWritten({ ...TRIGGER, document: 'dmThreads/{threadId}/responses/{responseId}' }, (event) =>
  notifyCardAnswer('dm', event.params.threadId, event.data?.before.data(), event.data?.after.data())
);

export const notifyCircleCardAnswer = onDocumentWritten({ ...TRIGGER, document: 'circles/{circleId}/responses/{responseId}' }, (event) =>
  notifyCardAnswer('circle', event.params.circleId, event.data?.before.data(), event.data?.after.data())
);

// ---------------------------------------------------------------- reports

// App Store guideline 1.2 expects reports to be acted on within 24 hours, so
// each one pings the admins. They're reviewed in the Firebase console
// (Firestore > reports); set status to 'resolved' there when done.
export const notifyReport = onDocumentCreated({ ...TRIGGER, document: 'reports/{reportId}' }, async (event) => {
  const r = event.data?.data();
  if (!r) return;
  logger.warn('New moderation report', { id: event.params.reportId, kind: r.kind, reason: r.reason, targetPath: r.targetPath });
  const admins = ADMIN_UIDS.value()
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (admins.length === 0) return;
  await sendPush(admins, { title: `New report: ${r.reason}`, body: clip(`${r.kind} · ${r.contentSnapshot || r.targetPath || ''}`), target: { type: 'reviewReminder' } }, null, null);
});
