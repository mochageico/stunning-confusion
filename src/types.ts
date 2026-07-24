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
  drillType: 'speak' | 'type' | 'reveal';
}

// A circle-scoped, manager-curated shared memorization plan. Members join it
// and its verses feed automatically into their own personal queue (see
// src/lib/studyPlanScheduler.ts) at whatever weekly pace the manager sets --
// there's no separate "learning days" here, and no manual pointer; deployment
// timing always comes from each member's own personal learningDays/pace.
export interface StudyPlan {
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

// A member's relationship to one joined StudyPlan -- in particular, how that
// plan's verses should compete with the member's own individual queue when
// there isn't enough daily capacity for both. See computeDailyPull in
// src/lib/studyPlanScheduler.ts for exactly how each mode is resolved,
// especially when a member has joined more than one plan at once.
export interface StudyPlanMembership {
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
  originPlanId?: string;       // Which StudyPlan this verse came from, when origin === 'group' -- lets the scheduler charge it against that plan's own weekly pace budget, and lets leaveStudyPlan clean up only that plan's still-queued verses.

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
  userId?: string;
  user?: string;
  avatar?: string;
  category?: 'global' | 'group' | 'friends';
  versesStr?: string;
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

export interface MemoryPlan {
  id: string;
  name: string;
  preset: 'drip' | 'warrior' | 'custom';
  learningDays: string[];
  newVersesPace: number;
  maxReviewCap: number;
  // Retention rigor: how many weeks/months/years a verse spends in each
  // review phase before graduating. 'light'/'standard'/'deep' are named
  // presets (5-4-3 / 7-6-5 / 9-8-7); 'custom' means the three *PhaseX
  // fields below were hand-set and don't match a named preset.
  retentionRigor: 'light' | 'standard' | 'deep' | 'custom';
  dailyPhaseWeeks: number;
  weeklyPhaseMonths: number;
  monthlyPhaseYears: number;
  // Mastery-gate settings: these were previously live useState values that
  // drove the engine but were never part of the saved plan, so they didn't
  // survive a save/switch/reload. Now part of the plan like everything else.
  masteryTouches: number;
  reviewsRequired: number;
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
  // low/medium/high) -- previously a live useState with no UI control and
  // no persistence, so it silently reset to 'medium' every reload.
  cognitiveLoadSensitivity: 'low' | 'medium' | 'high';
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
  // Pause: a proactive "nothing is due, nothing counts as missed" window
  // (vacations, etc), distinct from the reactive miss-policy above. Treated
  // like Sabbath but for a date range instead of a single weekday. Null
  // pausedUntil with a set pausedAt means paused indefinitely until resumed
  // manually.
  pausedAt: string | null;
  pausedUntil: string | null;
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
