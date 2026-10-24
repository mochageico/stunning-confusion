import { Platform } from 'react-native';
import { createAudioPlayer, type AudioPlayer } from 'expo-audio';

import { getAppPrefs } from './appPrefs';

// ============================================================================
// PRACTICE FEEDBACK
// ----------------------------------------------------------------------------
// Settings > Recall and typing > Sounds / Vibration. A soft two-note chime when
// a verse is done, a low tone and a light tap on a miss. Both are off the
// moment the setting is, and neither ever interrupts practice if it fails.
// ============================================================================

const SOURCES = {
  done: require('../../assets/sounds/done.wav'),
  miss: require('../../assets/sounds/miss.wav'),
};

const players: Partial<Record<keyof typeof SOURCES, AudioPlayer>> = {};

function play(name: keyof typeof SOURCES) {
  try {
    const player = (players[name] ??= createAudioPlayer(SOURCES[name]));
    player.seekTo(0);
    player.play();
  } catch {
    // No sound is fine.
  }
}

// REQUIRED LAZILY, like expo-screen-orientation in App.tsx: an app build made
// before expo-haptics was added has no native module, and a top-level import
// would crash it at startup. Such a build just doesn't vibrate.
let haptics: typeof import('expo-haptics') | null | undefined;
function tap() {
  if (Platform.OS === 'web') return;
  if (haptics === undefined) {
    try {
      haptics = require('expo-haptics') as typeof import('expo-haptics');
    } catch {
      haptics = null;
    }
  }
  haptics?.notificationAsync(haptics.NotificationFeedbackType.Warning).catch(() => undefined);
}

/** A verse finished. */
export function feedbackDone() {
  if (getAppPrefs().sounds) play('done');
}

/** A wrong word. */
export function feedbackMiss() {
  const { sounds, vibration } = getAppPrefs();
  if (sounds) play('miss');
  if (vibration) tap();
}
