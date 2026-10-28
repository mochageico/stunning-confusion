import { QueueItem, ReviewLog } from '../types';
import { TOP_STEP, stepInfo } from './ladder';

// Review history (QueueItem.reviewLogs). Capped so a verse's document can
// never grow without bound; a full climb up the ladder is only a couple of
// hundred entries, so the cap is never reached in practice.
export const REVIEW_LOG_LIMIT = 500;

/**
 * The log's `stage` field keeps the old names so a friend on an older build
 * still reads it: Settling is 'daily', Steady 'weekly', Kept 'monthly' and the
 * top step (Secure) 'retained'. The exact step rides along as `step`.
 */
export const reviewStageOf = (item: QueueItem): ReviewLog['stage'] => {
  if (item.status === 'retained') return 'retained';
  if (item.status !== 'reviewing') return 'learning';
  if (item.ladderStep !== undefined) {
    if (item.ladderStep >= TOP_STEP) return 'retained';
    const group = stepInfo(item.ladderStep).group;
    return group === 'settling' ? 'daily' : group === 'steady' ? 'weekly' : 'monthly';
  }
  return item.retentionPhase !== 'none' ? item.retentionPhase : 'learning';
};

/**
 * Adds one entry to `draft.reviewLogs`. `stageOf` is the item as it stood
 * when the review happened -- pass the pre-change copy when the caller has
 * already moved the verse on.
 */
export const appendReviewLog = (
  draft: QueueItem,
  stageOf: QueueItem,
  result: ReviewLog['result'],
  extra: Omit<ReviewLog, 'at' | 'result' | 'stage' | 'refresher'> = {}
) => {
  const entry: ReviewLog = {
    at: new Date().toISOString(),
    result,
    stage: reviewStageOf(stageOf),
    ...(stageOf.refresherActive ? { refresher: true as const } : {}),
    ...extra,
  };
  draft.reviewLogs = [...(draft.reviewLogs || []), entry].slice(-REVIEW_LOG_LIMIT);
};
