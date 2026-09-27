import { QueueItem, ReviewLog } from '../types';

// Review history (QueueItem.reviewLogs). Capped so a verse's document can
// never grow without bound; a full Daily -> Weekly -> Monthly run is only a
// couple of hundred entries, so the cap is never reached in practice.
export const REVIEW_LOG_LIMIT = 500;

export const reviewStageOf = (item: QueueItem): ReviewLog['stage'] =>
  item.status === 'retained'
    ? 'retained'
    : item.status === 'reviewing' && item.retentionPhase !== 'none'
      ? item.retentionPhase
      : 'learning';

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
