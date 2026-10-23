import { useEffect, useRef, useState } from 'react';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { Pause, Play } from 'lucide-react-native';

import { Recording } from '../types';
import { AppButton } from './design';
import { resolveChapterAudio } from '../lib/appData';
import { hasPlayableAudio, resolvePlaybackUrl } from '../lib/studioAudio';

// ============================================================================
// VERSE PLAY BUTTON
// ----------------------------------------------------------------------------
// Plays one verse from the user's own recording of its chapter: seeks to the
// verse's tagged start and pauses at its end. Renders nothing when there is no
// recording, or the recording has no timing for this verse -- there is no
// text-to-speech fallback in the app.
// ============================================================================

export interface VersePlayButtonProps {
  book: string;
  chapter: number;
  verse: number;
  userRecordings: Recording[];
  selectedChapterAudios: Record<string, Recording | null>;
  studioPlaybackEnabled: boolean;
  audioCacheMap?: ReadonlyMap<string, string>;
  /** Stops any other playback (the app-wide "now playing" recording). */
  onStart?: () => void;
}

export default function VersePlayButton(props: VersePlayButtonProps) {
  const recording = resolveChapterAudio(props.userRecordings, props.selectedChapterAudios, props.book, props.chapter);
  const timing = hasPlayableAudio(recording) ? recording?.verseTimestamps?.find((t) => t.verse === props.verse) : undefined;
  const url = resolvePlaybackUrl(recording, props.studioPlaybackEnabled, props.audioCacheMap);
  if (!timing || !url) return null;
  return <Player url={url} startSec={timing.startSec} endSec={timing.endSec} onStart={props.onStart} />;
}

function Player({ url, startSec, endSec, onStart }: { url: string; startSec: number; endSec: number; onStart?: () => void }) {
  const player = useAudioPlayer(url);
  const [playing, setPlaying] = useState(false);
  // Only true once the seek has landed, so a stale playhead past endSec
  // can't stop it the moment it starts.
  const armed = useRef(false);

  useEffect(() => {
    const sub = player.addListener('playbackStatusUpdate', (status) => {
      if (!armed.current) return;
      // A chapter's last verse ends with the file, a fraction before endSec.
      const atEnd =
        status.didJustFinish || status.currentTime >= endSec - 0.05 || (status.duration > 0 && status.currentTime >= status.duration - 0.15);
      if (!atEnd) return;
      armed.current = false;
      player.pause();
      setPlaying(false);
    });
    return () => sub.remove();
  }, [player, endSec]);

  const stop = () => {
    armed.current = false;
    player.pause();
    setPlaying(false);
  };

  const start = () => {
    onStart?.();
    setPlaying(true);
    setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, shouldPlayInBackground: false, interruptionMode: 'doNotMix' }).catch(() => {});
    player.seekTo(startSec).then(() => {
      armed.current = true;
      player.play();
    });
  };

  return <AppButton variant="secondary" Icon={playing ? Pause : Play} label={playing ? 'Pause' : 'Play'} onPress={playing ? stop : start} />;
}
