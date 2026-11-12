import { useRef, useSyncExternalStore } from 'react';
import type { AppState } from './useAppState';

// How screens read the app state (optimization plan, Phase 2).
//
// useAppState() still builds one big object on every render. It runs once, in
// AppStateHost (App.tsx), which puts the newest object here and then tells the
// listeners. A screen asks for the few fields it uses with useAppFields(), and
// redraws only when one of those changes, instead of on every change anywhere
// in the app.
//
// The state hooks make every function anew on every render. So for a function
// field the picker hands out one lasting wrapper that calls the newest
// version; otherwise every screen would look changed every time.
//
// That is wrong for a function a screen calls WHILE DRAWING to work out what
// to show: the screen would not redraw when the function's hidden inputs
// change. Those are listed in READ_DEPS with the fields they read, and their
// wrapper is renewed whenever one of those fields changes, so the screen
// redraws then. A new function that answers a question (get…, is…, has…,
// can…, …For) and is called during drawing must be added there.

let current: AppState | null = null;
const listeners = new Set<() => void>();

/** Called by AppStateHost while it renders. */
export function setAppState(next: AppState) {
  current = next;
  // Development: the published object (demo overrides included), for
  // checking from the console which fields changed between two updates.
  if (__DEV__) (globalThis as any).__appStore = next;
}

/** Called by AppStateHost after it renders (in a layout effect). */
export function notifyAppState() {
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
};

const now = (): AppState => {
  if (!current) throw new Error('App state read before AppStateHost rendered');
  return current;
};

type Key = keyof AppState;

/**
 * Functions called while drawing, and the fields their answer depends on.
 * 'always': the inputs are not in AppState, so the function counts as changed
 * on every update (the screen redraws as it did before Phase 2).
 * Pure functions (formatTime, buildVerseTimestamps, isReviewDue,
 * countRangeProgress, validateTouch, getGreeting, getTodayDateString) and
 * readMarkerFor (read once when a chat opens) need no entry.
 */
const READ_DEPS: Partial<Record<Key, readonly Key[] | 'always'>> = {
  getTodayAbbreviation: ['dayStartHour'],
  isTodayLearningDay: ['dayStartHour', 'sabbathEnabled', 'sabbathDay', 'learningDays'],
  getEstimatedReviewTime: ['dayStartHour', 'sabbathEnabled', 'sabbathDay', 'pausedAt', 'pausedUntil'],
  getNewVerseRoom: ['memoryQueue', 'cognitiveLoadSensitivity', 'maxReviewCap', 'dayStartHour', 'sabbathEnabled', 'sabbathDay', 'pausedAt', 'pausedUntil'],
  getNextPullPreview: ['memoryQueue', 'newVersesPace', 'learningDays', 'joinedGroupPlanDetails', 'joinedGroupPlanMemberships'],
  getTodayPullPreview: ['memoryQueue', 'newVersesPace', 'learningDays', 'joinedGroupPlanDetails', 'joinedGroupPlanMemberships', 'dayStartHour', 'sabbathEnabled', 'sabbathDay'],
  isChatRecordingSaved: ['userRecordings'],
  // The read markers and each circle's latest message are not in AppState.
  // Whenever one of these answers flips for a thread or circle in the lists,
  // the matching unread count changes too, so the counts stand in for them.
  isDMThreadUnread: ['user', 'blockedUids', 'dmThreads', 'unreadDMCount'],
  isCircleChatUnread: ['user', 'blockedUids', 'myCircles', 'unreadCircleCount'],
  isVerseSelected: ['selectedVerseNumbers'],
  photosForChapter: ['chapterPhotos'],
  sectionsForChapter: ['chapterSections'],
  // Reads the log of nudges sent, which is not in AppState.
  canSendAccountabilityNudge: 'always',
};

const wrappers = new Map<string, { fn: (...args: any[]) => any; deps: unknown[] }>();
const NO_DEPS: unknown[] = [];

function wrapperFor(key: Key): unknown {
  const state = now() as any;
  const spec = READ_DEPS[key];
  if (spec === 'always') return state[key];
  const deps = spec ? spec.map((d) => state[d]) : NO_DEPS;
  const had = wrappers.get(key);
  if (had && (had.deps === deps || (had.deps.length === deps.length && had.deps.every((d, i) => d === deps[i])))) {
    return had.fn;
  }
  const fn = (...args: any[]) => (now() as any)[key](...args);
  wrappers.set(key, { fn, deps });
  return fn;
}

/** The value a picker hands out for one field. */
function pick(key: Key): unknown {
  const v = now()[key];
  return typeof v === 'function' ? wrapperFor(key) : v;
}

/**
 * Just these fields of the app state. The component redraws only when one of
 * them changes. Functions come back as lasting wrappers (see above).
 */
export function useAppFields<K extends Key>(...keys: K[]): Pick<AppState, K> {
  const last = useRef<Pick<AppState, K> | null>(null);
  const read = () => {
    const prev = last.current as any;
    let changed: string[] | null = prev === null ? null : [];
    const next = {} as any;
    for (const k of keys) {
      const v = pick(k);
      next[k] = v;
      if (changed && prev[k] !== v) changed.push(k as string);
    }
    if (changed && changed.length === 0) return prev as Pick<AppState, K>;
    // Demo, from the console: globalThis.__pickTrace = [] lists which fields
    // made which component redraw (to find values rebuilt on every render).
    const trace = (globalThis as any).__pickTrace;
    if (Array.isArray(trace) && changed) trace.push(changed.join(','));
    last.current = next;
    return next as Pick<AppState, K>;
  };
  return useSyncExternalStore(subscribe, read, read);
}
