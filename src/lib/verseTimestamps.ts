import type { VerseTimestamp } from '../types';

// Turns the sparse verse->tap-time map into a contiguous per-verse
// start/end range: a verse's start is its own tap (or the previous verse's
// end, if it was never tapped), and its end is the next tapped verse found
// ahead of it (or the total recording duration, if none of the remaining
// verses were tapped). Returns [] if nothing was tapped at all, rather than
// producing a single verse spanning the whole recording followed by
// degenerate zero-length ones — that's just "the feature wasn't used."
export const buildVerseTimestamps = (
  verseNumbers: number[],
  tapTimestamps: Record<number, number>,
  totalDurationSec: number
): VerseTimestamp[] => {
  if (Object.keys(tapTimestamps).length === 0) return [];

  const sorted = [...verseNumbers].sort((a, b) => a - b);
  const result: VerseTimestamp[] = [];
  let cursor = 0;
  for (let i = 0; i < sorted.length; i++) {
    const v = sorted[i];
    const start = tapTimestamps[v] !== undefined ? tapTimestamps[v] : cursor;
    let end = totalDurationSec;
    for (let j = i + 1; j < sorted.length; j++) {
      if (tapTimestamps[sorted[j]] !== undefined) {
        end = tapTimestamps[sorted[j]];
        break;
      }
    }
    result.push({ verse: v, startSec: Math.round(start), endSec: Math.round(end) });
    cursor = end;
  }
  return result;
};
