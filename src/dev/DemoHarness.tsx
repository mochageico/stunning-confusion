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
// activePlan, addVerses, mySchedule, verseSources, savedPlans, memoryCalendar, verseRoad, versePage,
// referenceDrill, threadDrill, guided, sections, outline, sectionOrder,
// whichSection, teachIt, mixedReview, takeaways, takeawayAsk,
// memberProfile, groupPlanDetail, fullHistory, dashboard, settings,
// findFriends, messages, dmThread, circleChat, recordingDetail, community,
// find, create, preview, groupDetail, record, profile, onboarding, tour, auth,
// modalLearn, modalListen, modalSave, modalProgress, modalMissed.
// blocks: not a screen of the app. It shows every shared building block
// (src/dev/BlocksGallery.tsx) in place of the app.
// Extra params: ios=1 reproduces iPhone font rendering in the browser (no
// synthesized bold, so a weight that isn't a real loaded face shows as the
// Regular it is on the phone); empty=1 skips the seeded queue; big=1 seeds
// 700 verses instead, for timing the screens that draw every verse;
// accent=<id> opens in that accent (navy, evergreen, burgundy, plum, walnut,
// ink) without changing the one saved in Settings; scale=1.5 renders at that
// text size, as if set in iOS Settings; notdue=1 (with modalLearn) practices
// verses that aren't due yet; n=3 (with modalLearn) practices the first 3
// seeded verses, enough for the Order drill. sections: Matthew 7 with the
// user's nine sections and memory phrase; edit=1 (with sections) opens Edit
// sections. outline: the same chapter, opened straight into First words in the
// practice screen (the Order setting there flips it to last to first).
// sectionOrder / whichSection / teachIt: the same chapter, opened on the Put in
// order, Which section or Teach-It tab of the practice screen. mixedReview:
// three chapters due (Matthew 7:1-14 with the user's sections, Romans 8,
// Philippians 4), opened on Mixed review's start sheet. takeaways: the path,
// with Matthew 7's sections 1 (written) and 6 (put off) on it and 13-14 next to
// unlock; takeawayAsk: Today, with the quiet card for section 7 (write=1 opens
// the form); open=1 (takeaways) opens the written stop (shared with Grace Church Men);
// circle=1 shows With my circle, circle=open opens David's takeaway and its replies;
// fresh=1 (either) starts with no takeaways written. groupDetail: the circle
// page with this week's totals (Tom's stats are last week's, so he counts as
// zero; a former member's doc and takeaway are left out); quiet=1 makes it a
// week nobody has reviewed yet.
//
// Screenshots: `npm run shots -- --all` (scripts/capture-screens.cjs).
// ============================================================================
import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import type { AppState } from '../state/useAppState';
import type { CircleMember, DMThread, SharedTakeaway, TakeawayReply } from '../types';
import { formatLabel } from '../lib/formatNames';
import { weekBounds } from '../lib/circleTotals';

/** Flip to true to see demo data on a phone. Dev builds only. */
const DEMO_ON_DEVICE = false;

const PARAMS =
  Platform.OS === 'web' && typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : null;

/** Decided once at startup, so the hooks below always run in the same order. */
export const DEMO_ENABLED = __DEV__ && (PARAMS ? PARAMS.has('s') : DEMO_ON_DEVICE);

/** The ?s= value, when demo mode is on. */
export const DEMO_SCREEN: string | null = DEMO_ENABLED && PARAMS ? PARAMS.get('s') : null;

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

/**
 * A plausible review log for a seeded verse, so the verse page has history to
 * show: three Learning passes, then Daily every day (one grace-covered miss),
 * then Weekly every week, up to the stage the verse is in now.
 */
function demoLogs(s: (typeof SPECS)[number]) {
  if (s.status === 'queued') return [];
  if (s.status === 'learning') return (s.touches ?? []).map((d) => ({ at: iso(-d, 8 + (d % 5)), result: 'pass', stage: 'learning' }));
  const phase = s.status === 'retained' ? 'retained' : s.phase;
  const dailyDays = phase === 'daily' ? 40 : 49;
  const weeklyWeeks = phase === 'weekly' ? 10 : phase === 'daily' ? 0 : 26;
  const start = -(dailyDays + weeklyWeeks * 7 + 3);
  const logs: { at: string; result: string; stage: string }[] = [];
  for (let i = 0; i < 3; i++) logs.push({ at: iso(start + i, 8 + i * 3), result: 'pass', stage: 'learning' });
  for (let d = 0; d < dailyDays; d++) logs.push({ at: iso(start + 3 + d, 8), result: d === 18 ? 'grace' : 'pass', stage: 'daily' });
  for (let w = 0; w < weeklyWeeks; w++) logs.push({ at: iso(start + 3 + dailyDays + w * 7, 8), result: 'pass', stage: 'weekly' });
  if (phase === 'monthly' || phase === 'retained') logs.push({ at: iso(-5, 8), result: 'pass', stage: phase });
  return logs.filter((l) => new Date(l.at).getTime() < now);
}

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
      reviewLogs: demoLogs(s),
      reviewsToday: 0,
    };
  });
}

// big=1: a 700-verse list, the size of a long-time user's, for timing the
// screens that draw every verse (My Verses, Today, a chapter page). Whole runs
// of real chapters, mostly far along the road, with placeholder text.
const BIG_CHAPTERS: [string, string, number, number][] = [
  ['Psalms', 'PSA', 119, 176], ['Romans', 'ROM', 8, 39], ['Romans', 'ROM', 12, 21], ['John', 'JHN', 1, 51],
  ['John', 'JHN', 15, 27], ['Matthew', 'MAT', 5, 48], ['Matthew', 'MAT', 6, 34], ['Matthew', 'MAT', 7, 29],
  ['Ephesians', 'EPH', 1, 23], ['Ephesians', 'EPH', 2, 22], ['Philippians', 'PHP', 2, 30], ['Philippians', 'PHP', 4, 23],
  ['Colossians', 'COL', 3, 25], ['Hebrews', 'HEB', 11, 40], ['James', 'JAS', 1, 27], ['Isaiah', 'ISA', 53, 12],
  ['Isaiah', 'ISA', 40, 31], ['1 Corinthians', '1CO', 13, 13], ['Psalms', 'PSA', 1, 6], ['Psalms', 'PSA', 23, 6],
  ['Psalms', 'PSA', 91, 16],
];
function buildBigQueue() {
  const out: ReturnType<typeof buildQueue> = [];
  let i = 0;
  for (const [book, id, chapter, count] of BIG_CHAPTERS) {
    for (let verse = 1; verse <= count && out.length < 700; verse++, i++) {
      // By position: the first ~60% Complete or Monthly, then Weekly, Daily,
      // a few Learning, and the last ones Waiting.
      const f = i / 700;
      const status = f < 0.25 ? 'retained' : f < 0.86 ? 'reviewing' : f < 0.93 ? 'learning' : 'queued';
      const phase = f < 0.6 ? 'monthly' : f < 0.75 ? 'weekly' : f < 0.86 ? 'daily' : 'none';
      const spec: Spec = {
        ref: `${book} ${chapter}:${verse}`,
        status,
        phase,
        due: status === 'queued' ? undefined : (i % 37) - 3,
        touches: status === 'queued' ? undefined : [1, 2, 3],
        streak: status === 'queued' ? 0 : 3 + (i % 9),
      };
      out.push({
        verseId: `BSB_${id}_${chapter}_${verse}`,
        translationId: 'BSB',
        book,
        chapter,
        verseNumber: verse,
        text: `Placeholder words for ${book} ${chapter}:${verse}, long enough to wrap onto a second line like a real verse would.`,
        orderIndex: i,
        status,
        origin: 'individual',
        originPlanId: undefined,
        retentionPhase: phase,
        dateStarted: status === 'queued' ? null : iso(-200),
        lastReviewDate: status === 'queued' ? null : iso(-3),
        nextReviewDueDate: spec.due === undefined ? null : iso(spec.due, 6),
        currentStreakCount: spec.streak ?? 0,
        totalSuccessfulReviews: 3 + (spec.streak ?? 0),
        gracePeriodUsedToday: false,
        touchLogs: (spec.touches ?? []).map((d) => ({ timestamp: iso(-d, 8), drillType: 'type' })),
        reviewLogs: demoLogs(spec),
        reviewsToday: 0,
      });
    }
  }
  return out;
}

// ?s=guided: Psalm 23 as a passage mid-learning. Verses 1 and 2 have one run
// each from earlier days (checks are ready), verse 3's run is 20 minutes old
// (ready in 40 min), and verse 4 is new. Replaces the default Psalm 23 rows.
function buildGuidedQueue() {
  const base = buildQueue().filter((q) => q.book !== 'Psalms' || q.chapter !== 23);
  const spec: [number, string, number | null][] = [
    [1, TEXT['Psalms 23:1'], -2 * 1440],
    [2, TEXT['Psalms 23:2'], -1 * 1440],
    [3, TEXT['Psalms 23:3'], -20],
    [4, 'Even though I walk through the valley of the shadow of death, I will fear no evil, for You are with me; Your rod and Your staff, they comfort me.', null],
  ];
  const psalm = spec.map(([verse, text, minutesAgo], i) => ({
    ...base[0],
    verseId: `BSB_PSA_23_${verse}`,
    book: 'Psalms',
    chapter: 23,
    verseNumber: verse,
    text,
    orderIndex: base.length + i,
    status: 'learning',
    origin: 'individual',
    originPlanId: undefined,
    retentionPhase: 'none',
    dateStarted: iso(-3),
    lastReviewDate: null,
    nextReviewDueDate: null,
    currentStreakCount: 0,
    totalSuccessfulReviews: 0,
    touchLogs: minutesAgo === null ? [] : [{ timestamp: new Date(now + minutesAgo * 60000).toISOString(), drillType: 'speak' }],
  }));
  return [...base, ...psalm];
}

// ?s=sections: Matthew 7 split the way the user split it, with the user's
// memory phrase (MIXED_REVIEW_PLAN.md). The last section has no label, to show
// the verse-range fallback.
const MATT7_STARTS = [1, 6, 7, 12, 13, 15, 21, 24, 28];
const MATT7_LABELS = [
  'Judging others',
  'Pearls before pigs',
  'Ask, seek, knock',
  'The golden rule',
  'The narrow gate',
  'Known by their fruit',
  'I never knew you',
  'Two builders',
];
const MATT7_PHRASE = 'john doe ate some edamame but not every apple'.split(' ');
// ?s=mixedReview: Matthew 7:1-14 (BSB) due today, before the rest of the
// queue so it comes first, with the sections above. Psalm 119:11 is moved off
// today so exactly three chapters are due.
const MATT7_TEXT = [
  'Do not judge, or you will be judged.',
  'For with the same judgment you pronounce, you will be judged; and with the measure you use, it will be measured to you.',
  'Why do you look at the speck in your brother’s eye, but fail to notice the beam in your own eye?',
  'How can you say to your brother, ‘Let me take the speck out of your eye,’ while there is still a beam in your own eye?',
  'You hypocrite! First take the beam out of your own eye, and then you will see clearly to remove the speck from your brother’s eye.',
  'Do not give dogs what is holy; do not throw your pearls before swine. If you do, they may trample them under their feet, and then turn and tear you to pieces.',
  'Ask, and it will be given to you; seek, and you will find; knock, and the door will be opened to you.',
  'For everyone who asks receives; he who seeks finds; and to him who knocks, the door will be opened.',
  'Which of you, if his son asks for bread, will give him a stone?',
  'Or if he asks for a fish, will give him a snake?',
  'So if you who are evil know how to give good gifts to your children, how much more will your Father in heaven give good things to those who ask Him!',
  'In everything, then, do to others as you would have them do to you. For this is the essence of the Law and the Prophets.',
  'Enter through the narrow gate. For wide is the gate and broad is the way that leads to destruction, and many enter through it.',
  'But small is the gate and narrow is the way that leads to life, and only a few find it.',
];
function buildMixQueue() {
  const base = buildQueue().map((q) => (q.book === 'Psalms' && q.chapter === 119 ? { ...q, nextReviewDueDate: iso(5, 6) } : q));
  const matt = MATT7_TEXT.map((text, i) => ({
    ...base[2],
    verseId: `BSB_MAT_7_${i + 1}`,
    book: 'Matthew',
    chapter: 7,
    verseNumber: i + 1,
    text,
    retentionPhase: 'daily',
    nextReviewDueDate: iso(0, 6),
  }));
  return [...matt, ...base].map((q, i) => ({ ...q, orderIndex: i }));
}

// ?s=takeaways / ?s=takeawayAsk: Matthew 7:1-14 (BSB), nothing due today. Verses
// 1-12 are in weekly reviews (sections 1, 6, 7 and 12 are ready), 13-14 are
// still daily (the next section to unlock).
function buildTakeawayQueue() {
  const base = buildQueue();
  const matt = MATT7_TEXT.map((text, i) => ({
    ...base[2],
    verseId: `BSB_MAT_7_${i + 1}`,
    book: 'Matthew',
    chapter: 7,
    verseNumber: i + 1,
    text,
    retentionPhase: i < 12 ? 'weekly' : 'daily',
    nextReviewDueDate: iso(5, 6),
  }));
  return [...matt, ...base].map((q, i) => ({ ...q, orderIndex: i }));
}

const matt7Sections = () => ({
  starts: MATT7_STARTS,
  labels: Object.fromEntries(MATT7_LABELS.map((label, i) => [MATT7_STARTS[i], label])),
  phraseWords: Object.fromEntries(MATT7_PHRASE.map((word, i) => [MATT7_STARTS[i], word])),
});

/** Web only: taps a button by its exact text once it shows up (gives up after ~10s). */
function tapWhenShown(text: string, role: 'button' | 'radio' = 'button', prefix = false) {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return;
  let tries = 0;
  const timer = setInterval(() => {
    const el = Array.from(document.querySelectorAll(`[role="${role}"]`)).find(
      (node) => {
        const t = (node as HTMLElement).innerText?.trim().toLowerCase() ?? '';
        return prefix ? t.startsWith(text.toLowerCase()) : t === text.toLowerCase();
      }
    ) as HTMLElement | undefined;
    if (el || ++tries > 40) clearInterval(timer);
    el?.click();
  }, 250);
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
// ?s=takeaways&circle=1: what Grace Church Men (c1) shared. Each person's
// takeaways are their own items, so David's and Micah's Matthew 7:1-5 both show.
const MY_SHARED_TEXT = 'Do not judge others, because I will be judged the same way.';
const MY_SHARED_NOTE = 'Take the beam out of my own eye first.';
const sharedItem = (id: string, authorUid: string, authorName: string, days: number, over: Partial<SharedTakeaway>): SharedTakeaway => ({
  id: `${authorUid}_${id}`, circleId: 'c1', takeawayId: id, authorUid, authorName, book: 'Matthew', chapter: 7,
  sectionStart: 1, sectionEnd: 5, bracketIndex: 0, text: '', createdAt: iso(days), updatedAt: iso(days), ...over,
});
const circleTakeaways = (withMine: boolean): SharedTakeaway[] => [
  sharedItem('Matthew|7|1', 'u3', 'David Kim', -1, {
    label: 'The beam and the speck',
    text: 'Fix my own heart before I try to fix my brother. Judging starts with the mirror.',
    note: 'Read this with my small group Tuesday and we sat on verse 5 for an hour.',
  }),
  sharedItem('Romans|8|28', 'u2', 'Sarah Miller', -3, {
    book: 'Romans', chapter: 8, sectionStart: 28, sectionEnd: 30, bracketIndex: 2, label: 'All things for good',
    text: 'God is working every single thing toward his good for us, even the parts I hate.',
  }),
  ...(withMine ? [sharedItem('Matthew|7|1', 'demo', 'Micah', -4, { label: MATT7_LABELS[0], text: MY_SHARED_TEXT, note: MY_SHARED_NOTE })] : []),
  sharedItem('Psalms|23|1', 'u7', 'Tom Alvarez', -6, {
    book: 'Psalms', chapter: 23, sectionStart: 1, sectionEnd: 3, bracketIndex: 1,
    text: 'I have everything I need because he leads me, not because I have it all figured out.',
  }),
];
const circleTakeawayReplies: Record<string, TakeawayReply[]> = {
  'u3_Matthew|7|1': [
    { id: 'tr1', fromUid: 'u2', fromName: 'Sarah Miller', text: 'this was fire', createdAt: iso(0, 7) },
    { id: 'tr2', fromUid: 'demo', fromName: 'Micah', text: 'Same section as mine. "Starts with the mirror" is going on my fridge.', createdAt: iso(0, 8) },
    { id: 'tr3', fromUid: 'u7', fromName: 'Tom Alvarez', text: 'Needed this today.', createdAt: iso(0, 9) },
  ],
  'u2_Romans|8|28': [{ id: 'tr4', fromUid: 'u3', fromName: 'David Kim', text: 'Amen.', createdAt: iso(-2) }],
};
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
  lastMessageFromUid: 'u2',
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
  // The live app state, for poking at actions from the browser console
  // (window.__demoState.setGuidedSetAside(...)). Web demo mode only.
  if (DEMO_ENABLED && Platform.OS === 'web') (globalThis as any).__demoState = real;

  // Wait for the real auth listener to settle first -- its signed-out branch
  // resets the queue, which would wipe a seed applied any earlier.
  useEffect(() => {
    if (!DEMO_ENABLED || booted.current || real.loadingAuth) return;
    booted.current = true;
    if (params.get('big') === '1') real.setMemoryQueue(buildBigQueue() as any);
    else if (params.get('empty') !== '1') real.setMemoryQueue((s === 'guided' ? buildGuidedQueue() : s === 'mixedReview' ? buildMixQueue() : s === 'takeaways' || s === 'takeawayAsk' ? buildTakeawayQueue() : buildQueue()) as any);
    real.setUserRecordings(recordings as any);
    // The Record tab starts with no passage until one is chosen; the demo
    // picks Romans 8 unless `nopassage=1` asks for the empty state.
    if (params.get('nopassage') !== '1') {
      real.setRecordingBook('Romans');
      real.setRecordingChapter(8);
    }
    // `paused=1` pauses reviews until resumed; `paused=<n>` for n days.
    const paused = params.get('paused');
    if (paused) {
      const days = Number(paused);
      real.setPausedAt(new Date(Date.now() - 86400000).toISOString());
      real.setPausedUntil(paused === '1' || !days ? null : new Date(Date.now() + days * 86400000).toISOString());
    }
    const tabFor: Record<string, 'community' | 'record' | 'profile'> = {
      community: 'community',
      find: 'community',
      create: 'community',
      preview: 'community',
      groupDetail: 'community',
      record: 'record',
      profile: 'profile',
    };
    if (s === 'groupDetail') {
      // What circles/c1/memberStats and this week's shared takeaways would hold.
      const week = weekBounds(new Date(), 0);
      const lastWeek = weekBounds(new Date(week.start.getTime() - DAY), 0).key;
      const thisWeek = params.get('quiet') === '1' ? lastWeek : week.key;
      const justNow = new Date(Date.now() - 60000).toISOString();
      real.seedCircleStats(
        'c1',
        [
          { uid: 'demo', weekStart: thisWeek, reviewed: 640, held: 120, updatedAt: justNow },
          { uid: 'u2', weekStart: thisWeek, reviewed: 820, held: 95, updatedAt: justNow },
          { uid: 'u3', weekStart: thisWeek, reviewed: 480, held: 70, updatedAt: justNow },
          { uid: 'u7', weekStart: lastWeek, reviewed: 200, held: 40, updatedAt: justNow },
          { uid: 'u9', weekStart: thisWeek, reviewed: 500, held: 900, updatedAt: justNow }, // left the circle
        ],
        params.get('quiet') === '1'
          ? []
          : [
              { authorUid: 'demo', createdAt: justNow },
              { authorUid: 'u2', createdAt: justNow },
              { authorUid: 'u3', createdAt: justNow },
              { authorUid: 'u9', createdAt: justNow },
            ]
      );
    }
    if (tabFor[s]) {
      real.selectTab(tabFor[s]);
      if (s === 'find' || s === 'create' || s === 'preview') real.setCommunitySubView(s);
      return;
    }
    if (s === 'chapters') real.navigateTo('chapters', 'Romans');
    else if (s === 'chapterLanding') real.navigateTo('chapterLanding', 'Romans', 8);
    else if (s === 'sections') {
      // Saved through the real hook: with no Firebase user it stays local, so
      // editing in the demo works and writes nothing.
      void real.saveChapterSections('Matthew', 7, matt7Sections());
      real.navigateTo('chapterLanding', 'Matthew', 7);
      if (params.get('edit') === '1') tapWhenShown('Sections');
    } else if (s === 'outline') {
      // The chapter page's own First words button, once the chapter has loaded.
      void real.saveChapterSections('Matthew', 7, matt7Sections());
      real.navigateTo('chapterLanding', 'Matthew', 7);
      tapWhenShown('First words');
    } else if (s === 'sectionOrder' || s === 'whichSection' || s === 'teachIt') {
      // The same way in as First words, then the tab for this drill.
      void real.saveChapterSections('Matthew', 7, matt7Sections());
      real.navigateTo('chapterLanding', 'Matthew', 7);
      tapWhenShown('First words');
      tapWhenShown(formatLabel(s === 'sectionOrder' ? 'putInOrder' : s), 'radio');
    }
    else if (s === 'takeaways' || s === 'takeawayAsk') {
      void real.saveChapterSections('Matthew', 7, matt7Sections());
      // Section 1 written (with a note), section 6 put off; 7 and 12 are left to ask.
      if (params.get('fresh') !== '1') {
        void real.saveTakeaway(
          { book: 'Matthew', chapter: 7, sectionStart: 1, sectionEnd: 5, label: MATT7_LABELS[0], index: 0 },
          // Shared with Grace Church Men (c1), as its copy below.
          { text: MY_SHARED_TEXT, note: MY_SHARED_NOTE, status: 'saved', sharedTo: ['c1'] }
        );
        void real.saveTakeaway({ book: 'Matthew', chapter: 7, sectionStart: 6, sectionEnd: 6, label: MATT7_LABELS[1] }, { text: '', status: 'later' });
      }
      real.seedCircleTakeaways('c1', circleTakeaways(params.get('fresh') !== '1'), members.map((m) => m.uid), circleTakeawayReplies);
      if (s === 'takeaways') {
        real.navigateTo('takeaways');
        // open=1 opens the written stop; circle=1 switches to With my circle,
        // and circle=open also opens David's takeaway with its replies.
        if (params.get('open') === '1') tapWhenShown('Judging others', 'button', true);
        // fold=1 folds Matthew 7 on the path (tap its chapter pill).
        if (params.get('fold') === '1') tapWhenShown('Matthew 7', 'button', true);
        const circle = params.get('circle');
        if (circle) {
          tapWhenShown('With my circle', 'radio');
          if (circle === 'open') setTimeout(() => tapWhenShown('David', 'button', true), 600);
        }
      }
      else if (params.get('write') === '1') tapWhenShown('Write it');
    }
    else if (s === 'mixedReview') {
      void real.saveChapterSections('Matthew', 7, matt7Sections());
      real.openMixedReview();
      // start=1 goes straight into the session.
      if (params.get('start') === '1') tapWhenShown('Start');
    }
    else if (s === 'planDesigner') real.openActivePlanDesigner();
    else if (s === 'guided') real.openGuided('BSB|Psalms|23|1');
    else if (s === 'versePage') real.openVersePage({ book: 'Philippians', chapter: 4, verses: [6, 7], translationId: 'BSB' });
    // preset=1 opens Pick up the thread the way a passing Recall does: on a
    // verse (Romans 8:2, due today in the seeded queue, so its credit shows).
    // Without it, setup opens on every matching chapter.
    else if (s === 'threadDrill' && params.get('preset') === '1')
      real.openThreadDrill({ book: 'Romans', chapter: 8, verse: 2, translationId: 'BSB' });
    // navigateTo, not setCurrentScreen: it also switches to the screen's tab
    // (the Verses tab's screens render only while that tab is current).
    else if (s !== 'home' && s !== 'auth' && s !== 'onboarding' && s !== 'tour' && !s.startsWith('modal'))
      real.navigateTo(s as any);
  }, [real.loadingAuth]);

  if (!DEMO_ENABLED) return real;
  if (s === 'auth') return { ...real, user: null, loadingAuth: false };
  if (s === 'loading') return { ...real, loadingAuth: true };

  const circleMsgs = msgs([
    ['u2', 'Morning all! Anyone else stuck on verse 38?'],
    ['demo', 'Yes — the list of "neither… nor" is brutal.'],
    ['u2', 'I sing it. Helps a lot.'],
    ['demo', 'Asked for a recording of Romans 8:31-39'],
    ['u3', 'Shared a recording of Psalms 23'],
  ]).map((m, i) => ({
    ...m,
    id: `cm${i}`,
    fromName: m.fromUid === 'demo' ? 'Micah' : m.fromUid === 'u3' ? 'David Kim' : 'Sarah Miller',
  }));
  (circleMsgs[3] as any).attachment = { kind: 'recordingRequest', book: 'Romans', chapter: 8, startVerse: 31, endVerse: 39, translationId: 'BSB' };
  (circleMsgs[4] as any).attachment = { kind: 'recording', sharedRecordingId: 'shared_r9', book: 'Psalms', chapter: 23, translation: 'BSB', duration: 95, ownerName: 'David Kim' };
  const overrides: Partial<AppState> & Record<string, unknown> = {
    user: DEMO_USER,
    loadingAuth: false,
    // Sample data is all in place already; nothing to wait for.
    queueReady: true,
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
    // Social additions (block/report, unread, chat cards). Sarah's thread and
    // the first circle's chat show as unread; the guidelines are accepted so
    // the sheet doesn't cover every screen (?guidelines=1 shows it).
    guidelinesAcceptedAt: params.get('guidelines') === '1' ? null : iso(-10),
    guidelinesPromptOpen: params.get('guidelines') === '1',
    isDMThreadUnread: (t: DMThread) => t.id === 'dm1',
    isCircleChatUnread: (id: string) => id === 'c1',
    unreadDMCount: 1,
    unreadCircleCount: 1,
    readMarkerFor: () => new Date(now - 2.5 * 3600000).toISOString(),
    blockedUsers: params.get('blocked') === '1' ? [{ uid: 'u9', displayName: 'Chris Stone', blockedAt: iso(-2) }] : [],
    blockedUids: new Set<string>(),
    notificationPermission: params.get('notif') === 'off' ? 'undetermined' : 'granted',
    notificationPrefs: { messages: true, circleChat: true, friendActivity: true, reviewReminder: true, reminderHour: 8, reminderMinute: 0, mutedCircleIds: [] },
    notificationAskReason: params.get('ask') === '1' ? 'Know when Sarah replies?' : null,
    responsesByMessageId: {
      m3: [{ id: 'm3_demo', messageId: 'm3', uid: 'demo', name: 'Micah', status: 'willDo', updatedAt: iso(0, 9) }],
      m4: [{ id: 'm4_demo', messageId: 'm4', uid: 'demo', name: 'Micah', status: 'done', score: 92, updatedAt: iso(0, 9) }],
      cm3: [
        { id: 'cm3_u3', messageId: 'cm3', uid: 'u3', name: 'David Kim', status: 'done', sharedRecordingId: 'shared_r9', updatedAt: iso(0, 9) },
        { id: 'cm3_u7', messageId: 'cm3', uid: 'u7', name: 'Tom Alvarez', status: 'willDo', updatedAt: iso(0, 9) },
      ],
    },
  };
  if (s === 'onboarding') overrides.showOnboarding = true;
  if (s === 'tour') overrides.showTour = true;
  if (s === 'groupDetail') overrides.viewingGroupDetail = true;
  if (s === 'preview') overrides.previewCircle = publicCircles[1];
  if (s === 'groupPlanDetail') overrides.viewingGroupPlan = groupPlan;
  if (s === 'recordingDetail') overrides.selectedRecording = recordings[0] as any;
  if (s === 'dmThread') {
    overrides.activeDMThread = dmThread;
    const base: any[] = msgs([
      ['u2', 'Did you finish Romans 8 yet?'],
      ['demo', 'Up to verse 29! 28 took me forever.'],
      ['u2', 'Ha. Want to race me to the end?'],
      ['u2', 'Asked for a recording of Psalms 23'],
      ['u2', 'Sarah Miller quizzed you on John 15:5'],
      ['demo', 'Shared Romans 8:28 (BSB)'],
    ]);
    base[3].attachment = { kind: 'recordingRequest', book: 'Psalms', chapter: 23, translationId: 'KJV' } as any;
    base[4].attachment = { kind: 'quiz', toUid: 'demo', translationId: 'BSB', book: 'John', bookId: 'JHN', chapter: 15, verse: 5, hidePercent: 50 } as any;
    base[5].attachment = { kind: 'verse', translationId: 'BSB', book: 'Romans', bookId: 'ROM', chapter: 8, startVerse: 28, endVerse: 28 } as any;
    overrides.activeDMMessages = base;
    overrides.loadingActiveDMMessages = false;
    overrides.activeDMThreadActive = true;
  }
  if (s === 'circleChat') {
    overrides.activeCircleChatId = 'c1';
    overrides.activeCircleMessages = circleMsgs;
    overrides.loadingActiveCircleMessages = false;
  }
  if (s === 'quiz') {
    overrides.activeQuiz = {
      threadId: 'dm1',
      messageId: 'm4',
      fromName: 'Sarah Miller',
      attachment: { kind: 'quiz', toUid: 'demo', translationId: 'BSB', book: 'John', bookId: 'JHN', chapter: 15, verse: 5, hidePercent: 50 },
    } as any;
  }
  // `request=1` shows the Record tab while recording for someone's request.
  if (params.get('request') === '1') {
    overrides.activeRecordingRequest = {
      scope: 'dm',
      containerId: 'dm1',
      messageId: 'm3',
      requesterName: 'Sarah Miller',
      attachment: { kind: 'recordingRequest', book: 'Psalms', chapter: 23 },
    } as any;
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
    // notdue=1: Psalms 23:1-2, on a weekly schedule and not due for 3 days --
    // Recall shows practice, not "Count as a review".
    const picked = params.get('notdue') === '1' ? q.filter((x) => x.book === 'Psalms' && x.chapter === 23 && x.verseNumber <= 2) : q.slice(0, Math.max(1, Number(params.get('n')) || 2));
    overrides.modalVerses = picked.map((x) => ({ book: x.book, chapter: x.chapter, verse: x.verseNumber, text: x.text, status: 'learning' })) as any;
  }
  if (s === 'modalSave') overrides.saveRecordingDialog = true;
  // `recording=1` shows the Record tab mid-take, without the microphone.
  if (params.get('recording') === '1') {
    overrides.isRecording = true;
    overrides.recordingSeconds = 134;
    overrides.verseTapTimestamps = { 1: 0, 2: 6, 3: 13 };
  }
  // `playing=1` shows the now-playing bar above the tabs, without real audio.
  if (params.get('playing') === '1') {
    overrides.playingRecordingId = recordings[0].id;
    overrides.nowPlayingRecording = recordings[0] as any;
    overrides.playingRecProgress = 40;
  }
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
