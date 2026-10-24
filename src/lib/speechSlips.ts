import { useSyncExternalStore } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { deleteDoc, deleteField, doc, getDoc, increment, setDoc } from 'firebase/firestore';

import { auth, db } from '../firebase';
import { isLearnableSlip, setLearnedSlips, slipKey, tokenizeWords } from './recitation';

// ============================================================================
// LEARNED SPEECH SLIPS
// ----------------------------------------------------------------------------
// Every speech engine has words it reliably gets wrong for a given voice --
// in the 2026-10 bake-off Apple wrote "that" for "set" four times in one
// Romans 8 recitation, and a lisp or an accent has its own steady set. When
// someone taps a red word to say "I did say that", the pair (the verse word,
// what the engine wrote) is counted here; once the same pair has been fixed
// SLIP_LEARN_AFTER times, the grader accepts it for this person as 'close'.
//
// Memory slips and engine slips look different: people misremember by
// meaning ("children" for "sons"), engines mishear by sound. Forgiving only
// the sound-alikes THIS person has proven, rather than anything that merely
// sounds similar, keeps real recall mistakes counting.
//
// Kept on the account (users/{uid}/settings/speechSlips, owner-only) so it
// follows the person to a new phone. Word pairs only -- never audio.
// ============================================================================

/** Fixes of the same pair before the grader accepts it on its own. */
export const SLIP_LEARN_AFTER = 2;

export interface SpeechSlip {
  key: string;
  /** The verse word, normalized ("set"). */
  expected: string;
  /** What the engine wrote instead ("that"). */
  heard: string;
  count: number;
}

let counts: Record<string, number> = {};
let slips: SpeechSlip[] = [];
const listeners = new Set<() => void>();

const slipsDoc = (uid: string) => doc(db, 'users', uid, 'settings', 'speechSlips');

const publish = () => {
  slips = Object.entries(counts)
    .map(([key, count]) => {
      const [expected, heard] = key.split('>');
      return { key, expected, heard, count };
    })
    .filter((s) => s.expected && s.heard)
    .sort((a, b) => b.count - a.count || a.expected.localeCompare(b.expected));
  setLearnedSlips(new Set(slips.filter((s) => s.count >= SLIP_LEARN_AFTER).map((s) => s.key)));
  listeners.forEach((l) => l());
};

/** Loads the signed-in person's slips, and swaps them on every account change. Call once at startup. */
export function startSpeechSlipSync(): () => void {
  let loadedFor: string | null = null;
  return onAuthStateChanged(auth, (user) => {
    const uid = user?.uid ?? null;
    if (uid === loadedFor) return;
    loadedFor = uid;
    counts = {};
    publish();
    if (!uid) return;
    getDoc(slipsDoc(uid))
      .then((snap) => {
        if (loadedFor !== uid) return; // switched accounts while this was loading
        const pairs = snap.exists() ? (snap.data().pairs as Record<string, unknown> | undefined) : undefined;
        counts = Object.fromEntries(
          Object.entries(pairs ?? {}).filter((e): e is [string, number] => typeof e[1] === 'number' && e[1] > 0)
        );
        publish();
      })
      .catch((err) => console.error('Failed to load learned speech slips:', err));
  });
}

/**
 * A tap-to-fix on a word speech graded missed. `heard` is what the engine
 * wrote in that word's place; nothing is learned when it wrote nothing (a
 * dropped word could just as well be a real skip) or more than one word.
 */
export function recordSpeechSlip(expectedWord: string, heard: string | null | undefined) {
  const uid = auth.currentUser?.uid;
  if (!uid || !heard) return;
  const [expected] = tokenizeWords(expectedWord);
  const heardTokens = tokenizeWords(heard);
  if (!expected || heardTokens.length !== 1 || !isLearnableSlip(expected, heardTokens[0])) return;
  const key = slipKey(expected, heardTokens[0]);
  counts = { ...counts, [key]: (counts[key] ?? 0) + 1 };
  publish();
  setDoc(slipsDoc(uid), { pairs: { [key]: increment(1) } }, { merge: true }).catch((err) =>
    console.error('Failed to save a learned speech slip:', err)
  );
}

/** Stops accepting one slip and starts its count over. */
export function forgetSpeechSlip(key: string) {
  const uid = auth.currentUser?.uid;
  const { [key]: _gone, ...rest } = counts;
  counts = rest;
  publish();
  if (!uid) return;
  setDoc(slipsDoc(uid), { pairs: { [key]: deleteField() } }, { merge: true }).catch((err) =>
    console.error('Failed to forget a speech slip:', err)
  );
}

export function forgetAllSpeechSlips() {
  const uid = auth.currentUser?.uid;
  counts = {};
  publish();
  if (!uid) return;
  deleteDoc(slipsDoc(uid)).catch((err) => console.error('Failed to clear speech slips:', err));
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** Every counted slip, most-fixed first; `count >= SLIP_LEARN_AFTER` ones are being accepted. */
export const useSpeechSlips = (): SpeechSlip[] => useSyncExternalStore(subscribe, () => slips);
