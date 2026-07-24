import { Recording } from '../types';

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
