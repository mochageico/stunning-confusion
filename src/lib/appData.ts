// Plain data helpers for app state: the canonical verse id, normalizers for
// loosely-typed Firestore docs, and small shape mappers. Pure -- no React.
import type { GroupPlan, MemoryPlan, QueueItem, Recording, VerseState } from '../types';

// Canonical QueueItem.verseId shape, translation-prefixed so the same
// book/chapter/verse in two different translations are two independent
// queue items with independent progress (e.g. "ESV_EPH_2_5" vs
// "KJV_EPH_2_5"). Every site that constructs a QueueItem's verseId should
// go through this instead of an ad-hoc template literal, since it must stay
// consistent across every call site or two code paths adding "the same"
// verse could silently create duplicate, non-deduplicating queue items.
// Pre-existing items from before translations existed keep their old
// translation-less id ("EPH_2_5") rather than being migrated -- see
// loadUserData's translationId default-to-'ESV' fallback.
export const buildVerseId = (translationId: string, bookId: string, chapter: number, verse: number): string =>
  `${translationId}_${bookId}_${chapter}_${verse}`;

// Back-compat: normalizes a raw Firestore 'groupPlans' doc into the current
// GroupPlan shape. Docs created before the group-plan revamp (the old
// single-plan model) have `scriptureRange`/`pacingPerWeek` instead of
// `verseIds`/`versesPerWeek`, and no `description`/`createdAt`/`updatedAt` --
// reading one of those directly as a GroupPlan left `verseIds` undefined,
// crashing any `plan.verseIds.length` in the UI. Same pattern already used
// for old MemoryPlan docs missing retention-rigor/mastery-touches fields.
export const normalizeGroupPlan = (planId: string, data: any): GroupPlan => ({
  planId,
  circleId: data.circleId,
  name: data.name || 'Untitled Plan',
  description: data.description || '',
  managerId: data.managerId,
  managerName: data.managerName,
  versesPerWeek: data.versesPerWeek ?? data.pacingPerWeek ?? 3,
  verseIds: data.verseIds || data.scriptureRange || [],
  createdAt: data.createdAt || data.startDate || new Date().toISOString(),
  updatedAt: data.updatedAt || data.startDate || new Date().toISOString(),
});

// Resolves which of the user's own recordings represents a given chapter's
// narration, mirroring the precedence ChapterLandingScreen's "Change"
// selector already used inline: an explicit user choice always wins;
// otherwise fall back to the first of this user's own recordings of that
// chapter. Shared (rather than duplicated) so PracticeModals' real-audio
// Listen mode and ChapterLandingScreen's audio card can never quietly
// disagree about which recording is "the" audio for a chapter.
export function resolveChapterAudio(
  userRecordings: Recording[],
  selectedChapterAudios: Record<string, Recording | null>,
  book: string,
  chapter: number
): Recording | null {
  const key = `${book}_${chapter}`;
  const assigned = selectedChapterAudios[key];
  if (assigned) return assigned;
  const matches = userRecordings.filter((r) => r.book.toLowerCase() === book.toLowerCase() && r.chapter === chapter);
  if (matches.length === 0) return null;
  // Lowest priority number wins (top of the drag-reorderable list on
  // ChapterLandingScreen); legacy recordings without a priority sort last.
  const sorted = [...matches].sort((a, b) => (a.priority ?? Number.MAX_SAFE_INTEGER) - (b.priority ?? Number.MAX_SAFE_INTEGER));
  return sorted[0];
}

// Shared QueueItem -> VerseState mapper for launching a practice session --
// mirrors the same shape HomeScreen/PracticeModals already build inline, but
// startReviewSession needs its own copy since it isn't a React component and
// can't reach a screen-local helper.
export function mapQueueItemsToVerseStates(items: QueueItem[]): VerseState[] {
  return items.map((item) => ({
    book: item.book,
    chapter: item.chapter,
    verse: item.verseNumber,
    text: item.text,
    status: item.status === 'retained' ? 'memorized' : 'learning',
    translationId: item.translationId || 'ESV',
  }));
}

/**
 * Drops keys whose value is `undefined` before a Firestore write.
 *
 * Firestore rejects an explicit `undefined` field value outright — "Unsupported
 * field value: undefined (found in field X)" — and this app's
 * initializeFirestore() call doesn't enable `ignoreUndefinedProperties`, so a
 * single optional field left unset fails the ENTIRE save. That already cost a
 * real recording once (full-chapter takes wrote `startVerse: undefined`).
 *
 * Optional fields on Recording are all "absent means default" by design, so
 * omitting them is the correct semantics, not a workaround. Applied at the
 * write sites rather than globally via ignoreUndefinedProperties, so a stray
 * undefined elsewhere in the app still surfaces loudly instead of being
 * silently dropped.
 */
export function stripUndefined<T extends Record<string, unknown>>(obj: T): T {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as T;
}

// Wire name for the membership list on memoryPlans/{uid}. These were called
// "study plans" before the rename to "group plans", but this key is already
// written into every existing user's document -- renaming it would orphan
// every membership on the next load and silently un-join everyone. The
// Firestore COLLECTION was always 'groupPlans' (circles/{id}/groupPlans), so
// this single field is the only place the old wording survives.
export const JOINED_GROUP_PLANS_FIELD = 'joinedStudyPlans';

// Normalizes a loosely-typed shared/friend plan doc into a real MemoryPlan.
// Retention fields only: adopting someone else's plan must never touch the
// adopter's Rhythm, and pre-split shared docs still carry the author's
// learningDays/newVersesPace/maxReviewCap, which are deliberately ignored
// here rather than copied over.
//
// `isActive`/`updatedAt` are set for the adopter; callers supply id + name.
export function normalizeAdoptedPlan(plan: any): MemoryPlan {
  return {
    id: '',
    name: plan.name || 'Custom Plan',
    retentionRigor: plan.retentionRigor || 'standard',
    dailyPhaseWeeks: plan.dailyPhaseWeeks ?? 7,
    weeklyPhaseMonths: plan.weeklyPhaseMonths ?? 6,
    monthlyPhaseYears: plan.monthlyPhaseYears ?? 5,
    masteryTouches: plan.masteryTouches ?? 3,
    reviewsRequired: plan.reviewsRequired ?? 1,
    missPolicy: plan.missPolicy || 'standard',
    missPolicyAskEveryTime: plan.missPolicyAskEveryTime ?? false,
    graceCount: plan.graceCount ?? 1,
    refresherDailyDays: plan.refresherDailyDays ?? 7,
    refresherWeeklyWeeks: plan.refresherWeeklyWeeks ?? 4,
    isActive: true,
    updatedAt: new Date().toISOString(),
  };
}
