import AsyncStorage from '@react-native-async-storage/async-storage';

// Practice preferences live on the device (AsyncStorage), not in the user's
// account: they're how someone likes to drill, not data anyone else sees.
//
// Two screens touch them. PracticeModals owns most of the blob (words hidden,
// hint mode, display, Build up settings). Settings owns "Restart after",
// which moved there because it's set once and rarely touched, unlike words
// hidden. Both merge into the same key rather than overwriting it, so neither
// clobbers the other's fields.
export const PRACTICE_PREFS_KEY = 'practice:hintPrefs:v1';

export type StrikeLimit = number | 'unlimited';
export const STRIKE_LIMITS: StrikeLimit[] = [3, 5, 10, 'unlimited'];
export const DEFAULT_STRIKE_LIMIT: StrikeLimit = 5;

export function isStrikeLimit(v: unknown): v is StrikeLimit {
  return v === 'unlimited' || typeof v === 'number';
}

export async function loadPracticePrefs(): Promise<Record<string, unknown>> {
  try {
    const raw = await AsyncStorage.getItem(PRACTICE_PREFS_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    // Corrupt or missing prefs: the caller keeps its defaults.
    return {};
  }
}

export async function savePracticePrefs(patch: Record<string, unknown>): Promise<void> {
  try {
    const current = await loadPracticePrefs();
    await AsyncStorage.setItem(PRACTICE_PREFS_KEY, JSON.stringify({ ...current, ...patch }));
  } catch {
    // Not worth interrupting practice over; the setting just won't stick.
  }
}
