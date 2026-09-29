import { Recording } from '../types';
import { formatDate, formatDuration } from './format';

// "Psalm 139" for a full-chapter recording, "Psalm 139:23-24" (or
// "Psalm 139:23" for a single verse) when startVerse/endVerse narrow it --
// mirrors the same undefined+undefined == full chapter convention used to
// build versesStr when the recording was saved (see useAppState.ts).
export function recordingLabel(rec: Pick<Recording, 'book' | 'chapter' | 'startVerse' | 'endVerse'>): string {
  if (rec.startVerse === undefined || rec.endVerse === undefined) {
    return `${rec.book} ${rec.chapter}`;
  }
  const range = rec.startVerse === rec.endVerse ? `${rec.startVerse}` : `${rec.startVerse}-${rec.endVerse}`;
  return `${rec.book} ${rec.chapter}:${range}`;
}

// "Sep 23 · BSB · 5:12", plus "· Imported" for uploaded audio -- the one
// summary line every list of recordings uses, instead of each screen writing
// its own ("2026-09-23 • BSB • 312 seconds" beside "05:12" for the same file).
export function recordingMeta(
  rec: Pick<Recording, 'date' | 'translation' | 'duration' | 'sourceType'>
): string {
  const parts = [formatDate(rec.date), rec.translation, formatDuration(rec.duration)].filter(Boolean);
  if (rec.sourceType === 'imported') parts.push('Imported');
  return parts.join(' · ');
}
