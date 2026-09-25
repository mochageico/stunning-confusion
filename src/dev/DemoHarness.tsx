// ============================================================================
// DEMO MODE — a dev-only way to see every screen without signing in.
//
// There is no guest mode, and sign-in is off-limits when checking UI work, so
// this wraps the real useAppState(): it fakes a signed-in user, seeds a
// realistic queue, and overrides the community data only Firestore could
// supply. Everything else (navigation, derived counts) is the real app.
//
// How to turn it on:
//   - Web preview: add ?s=<screen> to the URL, e.g. /?s=home or
//     /?s=chapterLanding&ios=1. No ?s means the normal app.
//   - A phone (Expo Go / dev client): set DEMO_ON_DEVICE below to true.
// It is inert in production builds whatever the flags say (__DEV__ gate).
//
// Screens: home, books, chapters, chapterLanding, audioFeed, planDesigner,
// activePlan, savedPlans, memoryDesk, memoryCalendar, referenceDrill,
// memberProfile, groupPlanDetail, fullHistory, dashboard, settings,
// findFriends, messages, dmThread, circleChat, recordingDetail, community,
// find, create, preview, groupDetail, record, profile, onboarding, tour, auth,
// modalLearn, modalListen, modalSave, modalProgress, modalMissed.
// Extra params: ios=1 reproduces iPhone font rendering in the browser (no
// synthesized bold, so a weight that isn't a real loaded face shows as the
// Regular it is on the phone); empty=1 skips the seeded queue;
// accent=<id> opens in that accent (navy, evergreen, burgundy, plum, walnut,
// ink) without changing the one saved in Settings; scale=1.5 renders at that
// text size, as if set in iOS Settings.
//
// Screenshots: `npm run shots -- --all` (scripts/capture-screens.cjs).
// ============================================================================
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import type { AppState } from '../state/useAppState';
import type { CircleMember, DMThread } from '../types';

/** Flip to true to see demo data on a phone. Dev builds only. */
const DEMO_ON_DEVICE = false;

const PARAMS =
  Platform.OS === 'web' && typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;

/** Decided once at startup, so the hooks below always run in the same order. */
export const DEMO_ENABLED = __DEV__ && (PARAMS ? PARAMS.has('s') : DEMO_ON_DEVICE);

/** The accent the demo URL asks for, if any. App.tsx applies it over the saved one. */
export const DEMO_ACCENT: string | null = DEMO_ENABLED && PARAMS ? PARAMS.get('accent') : null;

/** The text size the demo URL asks for, if any. App.tsx applies it. */
export const DEMO_FONT_SCALE: number | null =
  DEMO_ENABLED && PARAMS && PARAMS.get('scale') ? Number(PARAMS.get('scale')) || null : null;

const DAY = 86400000;
const now = Date.now();
const iso = (offsetDays: number, hour = 9) => {
  const d = new Date(now + offsetDays * DAY);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
};

const TEXT: Record<string, string> = {
  'Romans 8:1': 'Therefore, there is now no condemnation for those who are in Christ Jesus.',
  'Romans 8:2': 'For in Christ Jesus the law of the Spirit of life set you free from the law of sin and death.',
  'Romans 8:28': 'And we know that God works all things together for the good of those who love Him, who are called according to His purpose.',
  'Romans 8:29': 'For those God foreknew, He also predestined to be conformed to the image of His Son, so that He would be the firstborn among many brothers.',
  'Romans 8:31': 'What then shall we say in response to these things? If God is for us, who can be against us?',
  'Romans 8:32': 'He who did not spare His own Son but gave Him up for us all, how will He not also, along with Him, freely give us all things?',
  'Romans 8:37': 'No, in all these things we are more than conquerors through Him who loved us.',
  'Romans 8:38': 'For I am convinced that neither death nor life, neither angels nor principalities, neither the present nor the future, nor any powers,',
  'Romans 8:39': 'neither height nor depth, nor anything else in all creation, will be able to separate us from the love of God that is in Christ Jesus our Lord.',
  'Philippians 4:6': 'Be anxious for nothing, but in everything, by prayer and petition, with thanksgiving, present your requests to God.',
  'Philippians 4:7': 'And the peace of God, which surpasses all understanding, will guard your hearts and your minds in Christ Jesus.',
  'Psalms 119:11': 'I have hidden Your word in my heart that I might not sin against You.',
  'John 3:16': 'For God so loved the world that He gave His one and only Son, that everyone who believes in Him shall not perish but have eternal life.',
  'Psalms 23:1': 'The LORD is my shepherd; I shall not want.',
  'Psalms 23:2': 'He makes me lie down in green pastures; He leads me beside quiet waters.',
  'Psalms 23:3': 'He restores my soul; He guides me in the paths of righteousness for the sake of His name.',
  'John 1:1': 'In the beginning was the Word, and the Word was with God, and the Word was God.',
  'John 1:2': 'He was with God in the beginning.',
  'John 1:3': 'Through Him all things were made, and without Him nothing was made that has been made.',
};
const BOOK_ID: Record<string, string> = { Romans: 'ROM', Philippians: 'PHP', Psalms: 'PSA', John: 'JHN' };

type Spec = {
  ref: string;
  status: 'queued' | 'learning' | 'reviewing' | 'retained';
  phase?: 'none' | 'daily' | 'weekly' | 'monthly';
  due?: number; // days from today
  touches?: number[]; // days-ago of each touch log
  streak?: number;
  origin?: 'individual' | 'group';
};
const SPECS: Spec[] = [
  { ref: 'Romans 8:28', status: 'learning', phase: 'none', touches: [0, 1] },
  { ref: 'Romans 8:29', status: 'learning', phase: 'none', touches: [1] },
  { ref: 'Romans 8:1', status: 'reviewing', phase: 'daily', due: -1, touches: [1, 2, 3, 4, 5], streak: 9 },
  { ref: 'Romans 8:2', status: 'reviewing', phase: 'daily', due: 0, touches: [1, 2, 3, 4], streak: 8 },
  { ref: 'Philippians 4:6', status: 'reviewing', phase: 'weekly', due: 0, touches: [7, 14, 21], streak: 3 },
  { ref: 'Philippians 4:7', status: 'reviewing', phase: 'weekly', due: 0, touches: [7, 14, 21], streak: 3 },
  { ref: 'Psalms 119:11', status: 'reviewing', phase: 'monthly', due: 0, touches: [30, 60], streak: 2 },
  { ref: 'John 3:16', status: 'reviewing', phase: 'monthly', due: 18, touches: [12, 42], streak: 4 },
  { ref: 'Psalms 23:1', status: 'reviewing', phase: 'weekly', due: 3, touches: [4, 11], streak: 5 },
  { ref: 'Psalms 23:2', status: 'reviewing', phase: 'weekly', due: 3, touches: [4, 11], streak: 5 },
  { ref: 'Psalms 23:3', status: 'reviewing', phase: 'weekly', due: 3, touches: [4, 11], streak: 5 },
  { ref: 'John 1:1', status: 'retained', phase: 'monthly', due: 60, touches: [2, 6, 9], streak: 12 },
  { ref: 'John 1:2', status: 'retained', phase: 'monthly', due: 60, touches: [2, 6, 9], streak: 12 },
  { ref: 'John 1:3', status: 'retained', phase: 'monthly', due: 60, touches: [2, 6, 9], streak: 12 },
  { ref: 'Romans 8:31', status: 'queued', origin: 'group' },
  { ref: 'Romans 8:32', status: 'queued', origin: 'group' },
  { ref: 'Romans 8:37', status: 'queued' },
  { ref: 'Romans 8:38', status: 'queued' },
  { ref: 'Romans 8:39', status: 'queued' },
];

function buildQueue() {
  return SPECS.map((s, i) => {
    const [book, cv] = [s.ref.slice(0, s.ref.lastIndexOf(' ')), s.ref.slice(s.ref.lastIndexOf(' ') + 1)];
    const [chapter, verse] = cv.split(':').map(Number);
    return {
      verseId: `BSB_${BOOK_ID[book]}_${chapter}_${verse}`,
      translationId: 'BSB',
      book,
      chapter,
      verseNumber: verse,
      text: TEXT[s.ref],
      orderIndex: i,
      status: s.status,
      origin: s.origin ?? 'individual',
      originPlanId: s.origin === 'group' ? 'gp1' : undefined,
      retentionPhase: s.phase ?? 'none',
      dateStarted: s.status === 'queued' ? null : iso(-40),
      lastReviewDate: s.touches?.length ? iso(-s.touches[0]) : null,
      nextReviewDueDate: s.due === undefined ? null : iso(s.due, 6),
      currentStreakCount: s.streak ?? 0,
      totalSuccessfulReviews: (s.touches?.length ?? 0) + (s.streak ?? 0),
      gracePeriodUsedToday: false,
      touchLogs: (s.touches ?? []).map((d) => ({ timestamp: iso(-d, 8 + (d % 5)), drillType: d % 2 ? 'speak' : 'type' })),
      reviewsToday: 0,
    };
  });
}

const DEMO_USER = { uid: 'demo', displayName: 'Micah', email: 'demo@example.com', photoURL: null, emailVerified: true };

const circles = [
  {
    id: 'c1',
    name: 'Grace Church Men',
    description: 'Memorizing Romans 8 together this fall. Tuesday mornings, 6:30am.',
    isPublic: false,
    ownerId: 'demo',
    ownerName: 'Micah',
    inviteCode: 'GRACE7',
    createdAt: iso(-60),
    updatedAt: iso(-2),
  },
  {
    id: 'c2',
    name: 'Psalms Summer',
    description: 'One psalm a month, open to anyone.',
    isPublic: true,
    ownerId: 'u2',
    ownerName: 'Sarah Miller',
    inviteCode: 'PSALMS',
    createdAt: iso(-120),
    updatedAt: iso(-10),
  },
];
const publicCircles = [
  circles[1],
  {
    id: 'c3',
    name: 'Sermon on the Mount',
    description: 'Matthew 5-7 over a year, a few verses a week.',
    isPublic: true,
    ownerId: 'u6',
    ownerName: 'Pastor Dan',
    inviteCode: 'SOTM12',
    createdAt: iso(-200),
    updatedAt: iso(-5),
  },
];
const friends = [
  { uid: 'u2', displayName: 'Sarah Miller', avatarUrl: '', friendsSince: iso(-90) },
  { uid: 'u3', displayName: 'David Kim', avatarUrl: '', friendsSince: iso(-40) },
  { uid: 'u4', displayName: 'Elizabeth K.', avatarUrl: '', friendsSince: iso(-12) },
];
const members: CircleMember[] = [
  { uid: 'demo', displayName: 'Micah', avatarUrl: '', role: 'leader', joinedAt: iso(-60) },
  { uid: 'u2', displayName: 'Sarah Miller', avatarUrl: '', role: 'member', joinedAt: iso(-50) },
  { uid: 'u3', displayName: 'David Kim', avatarUrl: '', role: 'member', joinedAt: iso(-45) },
  { uid: 'u7', displayName: 'Tom Alvarez', avatarUrl: '', role: 'member', joinedAt: iso(-20) },
];
const groupPlan = {
  planId: 'gp1',
  circleId: 'c1',
  name: 'Romans 8 in 8 weeks',
  description: 'Five verses a week, all of chapter 8 by Thanksgiving.',
  managerId: 'demo',
  managerName: 'Micah',
  versesPerWeek: 5,
  verseIds: Array.from({ length: 39 }, (_, i) => `ROM_8_${i + 1}`),
  createdAt: iso(-30),
  updatedAt: iso(-3),
};
const dmThread: DMThread = {
  id: 'dm1',
  participantUids: ['demo', 'u2'] as [string, string],
  otherUid: 'u2',
  otherName: 'Sarah Miller',
  otherAvatarUrl: '',
  lastMessage: 'Did you finish Romans 8 yet?',
  lastMessageAt: iso(0, 8),
  createdAt: iso(-30),
};
const msgs = (who: [string, string][]) =>
  who.map(([from, text], i) => ({
    id: `m${i}`,
    fromUid: from,
    fromName: from === 'demo' ? 'Micah' : 'Sarah Miller',
    fromAvatarUrl: '',
    text,
    createdAt: new Date(now - (who.length - i) * 3600000).toISOString(),
  }));
const recordings = [
  {
    id: 'r1',
    title: 'Romans 8 Full Chapter',
    book: 'Romans',
    chapter: 8,
    translation: 'BSB',
    duration: 312,
    date: iso(-4).split('T')[0],
    userId: 'demo',
    user: 'Micah',
    sharedVisibility: 'circle',
    sourceType: 'recorded',
    studioStatus: 'ready',
  },
  {
    id: 'r2',
    title: 'Psalm 23',
    book: 'Psalms',
    chapter: 23,
    translation: 'BSB',
    duration: 74,
    date: iso(-12).split('T')[0],
    userId: 'demo',
    user: 'Micah',
    startVerse: 1,
    endVerse: 6,
    sharedVisibility: 'private',
    sourceType: 'imported',
  },
];

let injected = false;
function injectIosFontEmulation() {
  if (injected || Platform.OS !== 'web' || typeof document === 'undefined') return;
  injected = true;
  const el = document.createElement('style');
  el.textContent = '* { font-synthesis: none !important; }';
  document.head.appendChild(el);
}

/**
 * Returns `real` untouched unless demo mode is on (see the top of this file).
 * Always calls the same hooks either way, so it is safe to call
 * unconditionally from AppShell.
 */
export function useDemoState(real: AppState): AppState {
  const params = PARAMS ?? new URLSearchParams();
  const s = params.get('s') || 'home';
  const booted = useRef(false);

  if (DEMO_ENABLED && params.get('ios') === '1') injectIosFontEmulation();

  // Wait for the real auth listener to settle first -- its signed-out branch
  // resets the queue, which would wipe a seed applied any earlier.
  useEffect(() => {
    if (!DEMO_ENABLED || booted.current || real.loadingAuth) return;
    booted.current = true;
    if (params.get('empty') !== '1') real.setMemoryQueue(buildQueue() as any);
    real.setUserRecordings(recordings as any);
    const tabFor: Record<string, 'community' | 'record' | 'profile'> = {
      community: 'community',
      find: 'community',
      create: 'community',
      preview: 'community',
      groupDetail: 'community',
      record: 'record',
      profile: 'profile',
    };
    if (tabFor[s]) {
      real.selectTab(tabFor[s]);
      if (s === 'find' || s === 'create' || s === 'preview') real.setCommunitySubView(s);
      return;
    }
    if (s === 'chapters') real.navigateTo('chapters', 'Romans');
    else if (s === 'chapterLanding') real.navigateTo('chapterLanding', 'Romans', 8);
    else if (s === 'planDesigner') real.openActivePlanDesigner();
    else if (s !== 'home' && s !== 'auth' && s !== 'onboarding' && s !== 'tour' && !s.startsWith('modal'))
      real.setCurrentScreen(s as any);
  }, [real.loadingAuth]);

  if (!DEMO_ENABLED) return real;
  if (s === 'auth') return { ...real, user: null, loadingAuth: false };

  const circleMsgs = msgs([
    ['u2', 'Morning all! Anyone else stuck on verse 38?'],
    ['demo', 'Yes — the list of "neither… nor" is brutal.'],
    ['u2', 'I sing it. Helps a lot.'],
  ]);
  const overrides: Partial<AppState> & Record<string, unknown> = {
    user: DEMO_USER,
    loadingAuth: false,
    myCircles: circles,
    loadingMyCircles: false,
    publicCircles,
    loadingPublicCircles: false,
    friends,
    loadingFriends: false,
    incomingFriendRequests: [
      { id: 'fr1', fromUid: 'u5', fromName: 'Josh Carter', toUid: 'demo', toName: 'Micah', status: 'pending', createdAt: iso(-1) },
    ],
    outgoingFriendRequests: [],
    activityEvents: [
      { id: 'a1', uid: 'u2', authorName: 'Sarah Miller', book: 'Romans', chapter: 8, type: 'chapter', verseCount: 39, createdAtMs: now - 2 * 3600000 },
      { id: 'a2', uid: 'u3', authorName: 'David Kim', book: 'Psalms', chapter: 23, type: 'verse', verse: 4, createdAtMs: now - DAY },
      { id: 'a3', uid: 'u4', authorName: 'Elizabeth K.', book: 'John', chapter: 15, type: 'verse', verse: 5, createdAtMs: now - 3 * DAY },
    ],
    loadingActivityEvents: false,
    receivedAccountabilityNudges: [
      { id: 'n1', fromUid: 'u2', fromName: 'Sarah Miller', fromAvatarUrl: '', toUid: 'demo', message: 'Keep going — you are almost through Romans 8!', createdAt: iso(0, 7), read: false },
    ],
    loadingAccountabilityNudges: false,
    dmThreads: [dmThread, { ...dmThread, id: 'dm2', otherUid: 'u3', otherName: 'David Kim', lastMessage: 'Challenge accepted.', lastMessageAt: iso(-2) }],
    loadingDmThreads: false,
    activeCircle: circles[0],
    activeCircleMembers: members,
    activeCircleGroupPlans: [groupPlan],
    loadingActiveCircle: false,
    joinedGroupPlanMemberships: [{ planId: 'gp1', circleId: 'c1', priority: 'group', joinedAt: iso(-20) }],
    joinedGroupPlanDetails: [groupPlan],
    activeCircleChallenges: [
      { id: 'gc1', circleId: 'c1', createdByUid: 'u2', createdByName: 'Sarah Miller', title: 'Psalm 23 sprint', book: 'Psalms', startChapter: 23, endChapter: 23, totalVerses: 6, status: 'active', createdAt: iso(-6) },
    ],
    loadingActiveCircleChallenges: false,
    activeChallenges: [
      {
        id: 'ch1', fromUid: 'u2', fromName: 'Sarah Miller', fromAvatarUrl: '', toUid: 'demo', toName: 'Micah', toAvatarUrl: '',
        participantUids: ['demo', 'u2'] as [string, string], dmThreadId: 'dm1', book: 'Romans', startChapter: 8, endChapter: 8, totalVerses: 39,
        status: 'active', createdAt: iso(-5), fromProgress: 21, toProgress: 14,
      },
    ],
    myChallengeBadges: [],
    circleFriends: members.slice(1),
  };
  if (s === 'onboarding') overrides.showOnboarding = true;
  if (s === 'tour') overrides.showTour = true;
  if (s === 'groupDetail') overrides.viewingGroupDetail = true;
  if (s === 'preview') overrides.previewCircle = publicCircles[1];
  if (s === 'groupPlanDetail') overrides.viewingGroupPlan = groupPlan;
  if (s === 'recordingDetail') overrides.selectedRecording = recordings[0] as any;
  if (s === 'dmThread') {
    overrides.activeDMThread = dmThread;
    overrides.activeDMMessages = msgs([
      ['u2', 'Did you finish Romans 8 yet?'],
      ['demo', 'Up to verse 29! 28 took me forever.'],
      ['u2', 'Ha. Want to race me to the end?'],
    ]);
    overrides.loadingActiveDMMessages = false;
    overrides.activeDMThreadActive = true;
  }
  if (s === 'circleChat') {
    overrides.activeCircleChatId = 'c1';
    overrides.activeCircleMessages = circleMsgs;
    overrides.loadingActiveCircleMessages = false;
  }
  if (s === 'memberProfile') {
    overrides.selectedUserProfile = {
      uid: 'u2',
      name: 'Sarah Miller',
      avatar: 'S',
      stats: { memorized: 84, learning: 3, streak: 12 },
      communities: ['Grace Church Men', 'Psalms Summer'],
      memoryQueueVisibility: 'private',
      sharedMemoryQueue: null,
    };
  }
  if (s === 'modalLearn' || s === 'modalListen') {
    const q = buildQueue();
    overrides.activeModal = s === 'modalLearn' ? 'learn' : 'listen';
    overrides.modalVerses = q.slice(0, 2).map((x) => ({ book: x.book, chapter: x.chapter, verse: x.verseNumber, text: x.text, status: 'learning' })) as any;
  }
  if (s === 'modalSave') overrides.saveRecordingDialog = true;
  if (s === 'modalProgress') overrides.showProgressModal = true;
  if (s === 'modalMissed') {
    const q = buildQueue();
    overrides.showMissedReviewPrompt = true;
    overrides.missedReviewQueue = [
      { item: q[4], missedCycles: 1 },
      { item: q[6], missedCycles: 2 },
    ] as any;
  }
  return { ...real, ...overrides } as AppState;
}
