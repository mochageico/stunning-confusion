export interface VerseState {
  book: string;
  chapter: number;
  verse: number;
  text: string;
  status: 'memorized' | 'learning' | 'untouched';
  dueDate?: string;
}

export interface BibleBook {
  id: string; // standard 3-character USFM book code, e.g. 'GEN', 'JHN'
  name: string; // display name, e.g. 'Genesis', 'John'
  testament: 'ot' | 'nt';
  chapters: number; // total chapter count in this book
}

export interface BibleTranslation {
  id: string; // short code, e.g. 'ESV', 'WEB'
  name: string; // full name, e.g. 'English Standard Version'
  copyright?: string; // required attribution text, when the translation is not public domain
  isPublicDomain: boolean;
}

export interface ChapterText {
  translationId: string;
  bookId: string;
  book: string;
  chapter: number;
  verses: Record<string, string>; // verse number (as string) -> verse text
  verseCount: number;
}

export interface TouchLog {
  timestamp: string;           // ISO timestamp of successful recall
  // 'speak'/'type' are machine-graded recall runs. 'reveal' means
  // self-reported: the user logged the review manually rather than reciting
  // it in the app (the manual-log action in PracticeModals' header, and on
  // Home's due-review rows). The name predates that action -- it was the old
  // Reveal tab's self-assessment buttons, which is what it always really
  // recorded -- and is kept so historical touch logs stay readable.
  drillType: 'speak' | 'type' | 'reveal';
}

// A circle-scoped, manager-curated shared memorization plan. Members join it
// and its verses feed automatically into their own personal queue (see
// src/lib/groupPlanScheduler.ts) at whatever weekly pace the manager sets --
// there's no separate "learning days" here, and no manual pointer; deployment
// timing always comes from each member's own personal learningDays/pace.
export interface GroupPlan {
  planId: string;
  circleId: string;
  name: string;
  description: string;
  managerId: string;           // User ID of the plan manager
  managerName?: string;
  versesPerWeek: number;       // target pace -- reconciled against each member's own capacity by the scheduler
  verseIds: string[];          // manager-curated queue, built incrementally over time (e.g. ["ROM_10_1", "ROM_10_2", ...])
  createdAt: string;
  updatedAt: string;
}

// A member's relationship to one joined GroupPlan -- in particular, how that
// plan's verses should compete with the member's own individual queue when
// there isn't enough daily capacity for both. See computeDailyPull in
// src/lib/groupPlanScheduler.ts for exactly how each mode is resolved,
// especially when a member has joined more than one plan at once.
export interface GroupPlanMembership {
  planId: string;
  circleId: string;
  // 'individual' -- the member's own queued verses are pulled first; this
  //   plan only gets whatever daily capacity is left over.
  // 'group' -- this plan's verses are pulled first, ahead of the member's
  //   own individual queue, but still capped by the member's daily capacity.
  // 'additive' -- this plan's own weekly pace is pulled in full every
  //   learning day on top of the member's personal daily cap, deliberately
  //   allowed to exceed it.
  priority: 'individual' | 'group' | 'additive';
  joinedAt: string;
}

export interface QueueItem {
  verseId: string;             // Unique identifier, now translation-prefixed (e.g., "ESV_ROM_8_1", "KJV_PHP_4_6") -- see buildVerseId in useAppState.ts. Pre-existing items from before translations existed keep their old translation-less id ("ROM_8_1"); translationId (below) is what's authoritative for display/matching, not the id's shape.
  translationId: string;       // e.g. "ESV" -- which translation's text this item's `text` field holds. Ephesians 2:5 in ESV and in KJV are two independent QueueItems with independent progress, not the same item.
  book: string;                // e.g., "Romans"
  chapter: number;             // e.g., 8
  verseNumber: number;         // e.g., 1
  text: string;                // Verse text
  orderIndex: number;          // Position in the queue
  status: 'queued' | 'learning' | 'reviewing' | 'retained';
  origin?: 'individual' | 'group'; // Origin of the verse (colored orange/red for individual, blue/purple for group)
  originPlanId?: string;       // Which GroupPlan this verse came from, when origin === 'group' -- lets the scheduler charge it against that plan's own weekly pace budget, and lets leaveGroupPlan clean up only that plan's still-queued verses.

  // 7-6-5 Retention System State
  retentionPhase: 'none' | 'daily' | 'weekly' | 'monthly';
  dateStarted: string | null;  // ISO string when first moved to 'learning'
  lastReviewDate: string | null; // ISO string when last practiced/reviewed
  nextReviewDueDate: string | null; // ISO string when next review is required

  // Progress counters
  currentStreakCount: number;  // Consecutive successful daily/weekly/monthly practices
  totalSuccessfulReviews: number; // Cumulative correct reviews

  // Grace Period state
  gracePeriodUsedToday: boolean; // Flag to prevent multiple grace uses in one day
  graceMissesUsed?: number; // Consecutive grace-covered misses used since the last successful review, checked against the plan's graceCount (default 0/undefined for plans still on the single-grace default)

  // 3-Touch Mastery State
  touchLogs?: TouchLog[];      // Tracks valid, hour-separated touches
  reviewsToday?: number;       // Tracks successful reviews for today

  // Demotion softening: a miss while in Daily doesn't send the verse back to
  // Learning anymore -- it just makes Daily's own graduation target longer.
  dailyPhaseExtensionDays?: number; // Extra days added to Daily's graduation target by misses (default 0)

  // Demotion softening: a miss while in Weekly/Monthly sends the verse down
  // for a temporary "refresher" stint instead of a full phase demotion. Its
  // progress in the original phase is preserved and resumed once the
  // refresher is cleared, rather than lost.
  refresherActive?: boolean;               // True while doing a temporary refresher stint
  refresherReturnPhase?: 'weekly' | 'monthly'; // Phase to resume once the refresher is cleared
  refresherReturnProgress?: number;        // currentStreakCount to restore on return
  refresherTargetUnits?: number;           // Successful reviews needed to clear the refresher (days if refreshing via Daily, weeks if refreshing via Weekly)

  // Chapter review-day anchoring ("Snap-to-Grid"): set once, the first time
  // ANY chunk of this book+chapter graduates out of Daily review, to
  // whichever weekday that happened to land on. Every other chunk of the
  // same chapter looks this up and snaps its own Weekly/Monthly due dates
  // onto it instead of drifting onto its own independent schedule -- so a
  // chapter learned in scattered daily pieces still converges onto one
  // shared review day. Never overwritten once set; absent on verses that
  // haven't graduated out of Daily yet (or predate this feature).
  chapterReviewAnchorDay?: string; // a DAY_ABBREVS value, e.g. 'M', 'Th'
}

export interface VerseTimestamp {
  verse: number;
  startSec: number;
  endSec: number;
}

// Real memorization-milestone event (Community activity feed) — fires only
// when a verse actually reaches the deep 'retained' status, the same
// long-term-mastery threshold that already drives "Memorized" everywhere
// else in the app (ProfileScreen's count, HomeScreen's grouping).
export interface ActivityEvent {
  id: string;
  uid: string;
  authorName: string;
  book: string;
  chapter: number;
  type: 'verse' | 'chapter';
  verse?: number; // set when type === 'verse'
  verseCount?: number; // set when type === 'chapter'
  createdAtMs: number; // client-side snapshot for sorting/display; Firestore createdAt is the source of truth
}

export interface Recording {
  id: string;
  title: string;
  book: string;
  chapter: number;
  translation: string;
  duration: number;
  date: string;
  audioUrl?: string;
  audioPath?: string; // Firebase Storage path, e.g. recordings/{uid}/{id}.m4a — needed to delete the blob
  // Studio mode: a de-essed / denoised / loudness-normalized render produced
  // by the processStudioAudio Cloud Function (see functions/src/index.ts).
  // The raw upload above is always kept and stays the fallback, so playback
  // never depends on processing having succeeded. Absent on every recording
  // predating studio mode, which is treated exactly like 'failed'.
  studioAudioUrl?: string;
  studioAudioPath?: string; // recordings/{uid}/{id}_studio.m4a — needed to delete the blob
  studioStatus?: 'pending' | 'ready' | 'failed';
  userId?: string;
  user?: string;
  avatar?: string;
  category?: 'global' | 'group' | 'friends';
  versesStr?: string;
  startVerse?: number; // undefined + endVerse undefined == full chapter (back-compat default)
  endVerse?: number;
  priority?: number; // ascending sort key among recordings sharing the same book+chapter;
  // undefined == legacy recording, sorts after any assigned priority (see resolveChapterAudio)
  verseTimestamps?: VerseTimestamp[]; // populated once auto-alignment (phase 2) runs; empty until then
  sharedVisibility?: 'private' | 'circle' | 'public'; // absent/undefined == 'private' (recordings predating this field)
  savedFromUid?: string; // set only on a reference copy saved via "Save to Library" — the original owner's uid
  savedFromRecordingId?: string; // the original sharedRecordings/recording id — used to detect "already saved"
  // 'imported' == tagged from a pre-existing audio file (see the Import
  // Audio flow in RecordScreen) rather than captured live with the mic.
  // Absent/undefined == 'recorded' (every recording before this field existed).
  sourceType?: 'recorded' | 'imported';
}

export interface GroupedQueueItem {
  id: string;
  book: string;
  chapter: number;
  verses: number[];
  status: string;
  origin: 'individual' | 'group';
  items: QueueItem[];
}

// Your personal cadence: which days you take on new verses, how many, how
// long a day's reviews may run, and when you're away. ONE per user, stored
// at the root of memoryPlans/{uid} -- deliberately NOT part of MemoryPlan.
//
// Everything here is a statement about your week and your capacity, not
// about a memorization method, so swapping plans no longer changes any of
// it (and adopting someone else's plan no longer imposes their schedule on
// you). The engine reads these values directly, which is why the Rhythm
// editor commits live rather than behind a Save button -- there was never a
// staged copy, only a persistence lag that pretended to be one.
export interface Rhythm {
  learningDays: string[];
  newVersesPace: number;
  maxReviewCap: number;
  // Sabbath: an optional single weekday, off by default, free from both
  // learning and reviewing -- the engine treats it as not existing at all
  // (due dates never land on it, and it doesn't count as elapsed time when
  // detecting silently-missed review cycles).
  sabbathEnabled: boolean;
  sabbathDay: string;
  // What hour (0/1/2) a new calendar day logically starts at, for both
  // review-scheduling rollover and the accountability-notification daily
  // limits -- lets a night owl's "today" not flip over at real midnight.
  // 0 (the default) is exactly today's existing midnight-based behavior.
  dayStartHour: number;
  // Multiplier applied to the daily time estimate (0.75/1.0/1.5 for
  // low/medium/high).
  cognitiveLoadSensitivity: 'low' | 'medium' | 'high';
  // Pause: a proactive "nothing is due, nothing counts as missed" window
  // (vacations, etc), distinct from the reactive miss-policy on the plan.
  // Treated like Sabbath but for a date range instead of a single weekday.
  // Null pausedUntil with a set pausedAt means paused indefinitely until
  // resumed manually. User-level, so activating a different plan can no
  // longer silently un-pause you.
  pausedAt: string | null;
  pausedUntil: string | null;
}

// A memorization METHOD: how a verse graduates, and what happens when you
// miss one. Nothing about your schedule or speed lives here -- see Rhythm.
// This is what's shareable, swappable, and comparable between people.
export interface MemoryPlan {
  id: string;
  name: string;
  // The one shipped plan (id BUILT_IN_PLAN_ID) is immutable: editing it
  // prompts for a new name and forks a copy, rather than mutating the
  // baseline everyone starts from. Absent/false on user-created plans.
  isBuiltIn?: boolean;
  // Retention rigor: how many weeks/months/years a verse spends in each
  // review phase before graduating. 'light'/'standard'/'deep' are named
  // presets (5-4-3 / 7-6-5 / 9-8-7); 'custom' means the three *PhaseX
  // fields below were hand-set and don't match a named preset.
  retentionRigor: 'light' | 'standard' | 'deep' | 'custom';
  dailyPhaseWeeks: number;
  weeklyPhaseMonths: number;
  monthlyPhaseYears: number;
  // Mastery-gate settings: how many successful touches graduate a verse,
  // and how many reviews are required per cycle.
  masteryTouches: number;
  reviewsRequired: number;
  // Missed-review handling: how many free misses before escalating, how
  // long the weekly->daily and monthly->weekly refreshers run, and whether
  // to just apply the preset automatically or ask via a popup each time
  // there's something to catch up on. 'graceDiscretion' is a distinct mode,
  // not just longer numbers -- see applyMissToItem's freeze branch.
  missPolicy: 'lenient' | 'standard' | 'graceDiscretion' | 'custom';
  missPolicyAskEveryTime: boolean;
  graceCount: number;
  refresherDailyDays: number;
  refresherWeeklyWeeks: number;
  isActive: boolean;
  updatedAt: string | Date;
}

export interface Circle {
  id: string;
  name: string;
  description: string;
  isPublic: boolean;
  ownerId: string;              // creator's uid — the only 'leader' in v1 (no promote/demote yet)
  ownerName: string;
  inviteCode: string;            // uppercase, used for private join-by-code
  createdAt: string;
  updatedAt: string;
}

export interface CircleMember {
  uid: string;
  displayName: string;
  avatarUrl: string;
  role: 'leader' | 'member';    // set once at creation, immutable in v1
  joinedAt: string;
}

// Real, mutual, persistent friend connection — independent of circle
// membership (survives leaving a shared circle), unlike the old
// "circleFriends" (real co-members across your circles, recomputed live).
export interface FriendRequest {
  id: string;
  fromUid: string;
  fromName: string;
  toUid: string;
  toName: string;
  status: 'pending' | 'accepted' | 'declined';
  createdAt: string;
}

export interface Friend {
  uid: string;
  displayName: string;
  avatarUrl: string;
  friendsSince: string;
}

// A friend-to-friend "accountability" nudge -- a custom-message notification,
// deliberately separate from any messaging/DM system. Immutable once sent
// (like activityEvents/friendRequests) except for the recipient marking it
// read. See profiles/{uid}/accountabilitySentLog/{friendUid} (sender's own
// private per-friend "did I already nudge them today" bookkeeping, not part
// of this doc) and profiles/{uid}/accountabilityMeta/counter (recipient's
// today-so-far received count, checked against UserProfile.accountabilityDailyCap).
export interface AccountabilityNudge {
  id: string;
  fromUid: string;
  fromName: string;
  fromAvatarUrl: string;
  toUid: string;
  message: string;
  createdAt: string;
  read: boolean;
}

// A 1:1 DM thread, stored at dmThreads/{threadId} where threadId is the two
// participant uids sorted and joined with '_' (so either side computes the
// same id without a lookup). Gated by friendship OR shared circle
// membership -- enforced server-side in firestore.rules (re-checked on every
// message send, not just thread creation), not just this snapshot. `active`
// is a client-computed, non-authoritative hint for inbox styling only.
export interface DMThread {
  id: string;
  participantUids: [string, string];
  otherUid: string;
  otherName: string;
  otherAvatarUrl: string;
  lastMessage: string;
  lastMessageAt: string;
  createdAt: string;
}

// A single message in either a DMThread or a circle's group chat.
// fromName/fromAvatarUrl are denormalized at send time (same trade-off as
// AccountabilityNudge) so rendering a thread never needs an extra profile
// fetch per message.
export interface ChatMessage {
  id: string;
  fromUid: string;
  fromName: string;
  fromAvatarUrl: string;
  text: string;
  createdAt: string;
}

// One emoji reaction from one user on one message -- doc id is always
// `${messageId}_${uid}` (both in dmThreads/{threadId}/reactions and
// circles/{circleId}/reactions), which caps each user to a single reaction
// per message (re-reacting overwrites the emoji; tapping the same emoji
// again deletes the doc) and lets firestore.rules verify the id against the
// fields without a second read.
export interface MessageReaction {
  id: string;
  messageId: string;
  uid: string;
  name: string;
  emoji: string;
  createdAt: string;
}

// A 1:1 "race this passage" challenge between two friends, modeled directly
// on FriendRequest's pending/accept/decline shape. Stored at
// challenges/{id}. Verses are added to each side's own Memory Queue
// (front-of-queue, like a MemorizationGoal range) the moment that side is
// present for it -- the sender at creation, the recipient at acceptance --
// so progress is always driven by real queue state, not a separate tracker.
export interface Challenge {
  id: string;
  fromUid: string;
  fromName: string;
  fromAvatarUrl: string;
  toUid: string;
  toName: string;
  toAvatarUrl: string;
  participantUids: [string, string]; // sorted, for array-contains queries
  dmThreadId: string; // which DM thread renders this challenge's card
  book: string;
  startChapter: number;
  endChapter: number;
  startVerse?: number; // only meaningful when startChapter === endChapter
  endVerse?: number;
  totalVerses: number;
  status: 'pending' | 'active' | 'declined' | 'completed' | 'cancelled';
  createdAt: string;
  respondedAt?: string;
  fromProgress: number; // verses out of 'queued' status, 0..totalVerses -- same completion definition as MemorizationGoal
  toProgress: number;
}

// Open-enrollment group challenge hosted inside a Circle -- any member can
// join (unlike GroupPlan, which is leader-curated). Stored at
// circles/{circleId}/challenges/{id}. Participants are their own self-owned
// subcollection docs (see GroupChallengeParticipant below), not a map field
// on this doc, so firestore.rules can restrict each participant to writing
// only their own entry.
export interface GroupChallenge {
  id: string;
  circleId: string;
  createdByUid: string;
  createdByName: string;
  title: string;
  book: string;
  startChapter: number;
  endChapter: number;
  startVerse?: number;
  endVerse?: number;
  totalVerses: number;
  status: 'active' | 'completed' | 'cancelled';
  createdAt: string;
}

// circles/{circleId}/challenges/{challengeId}/participants/{uid} -- self-owned,
// same shape/trust model as profiles/{uid}/friends/{friendUid}.
export interface GroupChallengeParticipant {
  uid: string;
  name: string;
  avatarUrl: string;
  progress: number; // verses out of 'queued' status, 0..the parent challenge's totalVerses
  joinedAt: string;
}

// My own record of a GroupChallenge I've joined -- denormalized onto
// memoryPlans/{uid}.joinedGroupChallenges, same "membership record" pattern
// GroupPlanMembership already uses for joinedGroupPlans. Self-contained
// (carries its own range/totalVerses) so progress-sync after a review never
// needs to re-fetch the parent GroupChallenge doc just to know what to count.
export interface GroupChallengeMembership {
  circleId: string;
  challengeId: string;
  book: string;
  startChapter: number;
  endChapter: number;
  startVerse?: number;
  endVerse?: number;
  totalVerses: number;
  joinedAt: string;
}

// Real user profile, stored at profiles/{uid}. memorizedCount/learningCount are
// denormalized snapshots the owning client patches in opportunistically, so
// other users can see meaningful stats without exposing private
// verses/memoryQueue subcollections.
export interface UserProfile {
  uid: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
  streakDays?: number;
  memorizedCount?: number;
  learningCount?: number;
  circleIds?: string[];
  // How many accountability nudges (from any friend, combined) this user is
  // willing to receive per logical day before senders are told they've hit
  // the cap. Undefined/missing defaults to ACCOUNTABILITY_DEFAULT_DAILY_CAP
  // in useAppState.ts.
  accountabilityDailyCap?: number;
}

/**
 * A photo of the physical Bible page(s) a chapter lives on — a visual anchor
 * for the text being memorized.
 *
 * Private to the owner, always. Unlike Recording there is deliberately no
 * shared/denormalized counterpart: a page photo reproduces a copyrighted
 * translation and routinely carries handwriting, marginalia, and family
 * register names, so the sharing path is absent rather than merely switched
 * off. See the chapterPhotos blocks in firestore.rules and storage.rules.
 */
export interface ChapterPhoto {
  id: string;
  /** `${book}_${chapter}` — the same key ChapterLandingScreen already builds. */
  chapterKey: string;
  /** Position within this chapter's gallery, ascending. */
  order: number;
  /**
   * Which verses this page covers. Both undefined == untagged, which reads as
   * "the whole chapter" and makes the photo sit out Listen's auto-flip rather
   * than fight it. Tagging is optional on purpose — forcing a range picker on
   * every add turns a five-second action into a chore.
   */
  verseStart?: number;
  verseEnd?: number;
  storagePath: string;
  thumbPath: string;
  url: string;
  thumbUrl: string;
  /**
   * Dimensions of the STORED (post-downscale) image, not the camera original.
   * Persisted so a thumbnail strip or the Listen panel can reserve the right
   * box before the bytes arrive — without them every photo pops the layout as
   * it decodes, which in Listen happens mid-session.
   */
  width: number;
  height: number;
}
