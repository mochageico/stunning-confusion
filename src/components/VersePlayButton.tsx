import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { Pause, Play } from 'lucide-react-native';

import { Recording } from '../types';
import { AppButton, AppText, useScaledSpace } from './design';
import { LIBRARY_READER, isLibraryRecording, libraryTimingsKey, resolveVerseAudio } from '../lib/libraryAudio';
import { resolvePlaybackUrl } from '../lib/studioAudio';
import { useLibraryTimings } from '../state/useLibraryAudio';

// ============================================================================
// VERSE PLAY BUTTON
// ----------------------------------------------------------------------------
// Plays one verse from the user's own recording of its chapter: seeks to the
// verse's tagged start and pauses at its end. Renders nothing when there is no
// recording, or the recording has no timing for this verse -- there is no
// text-to-speech fallback in the app. Hebrew Old Testament verses fall back
// to the built-in reading (see lib/libraryAudio.ts).
// ============================================================================

export interface VersePlayButtonProps {
  book: string;
  chapter: number;
  verse: number;
  /** Which translation the verse is shown in -- picks a recording in the same language. */
  translationId: string;
  userRecordings: Recording[];
  selectedChapterAudios: Record<string, Recording | null>;
  studioPlaybackEnabled: boolean;
  audioCacheMap?: ReadonlyMap<string, string>;
  /** Stops any other playback (the app-wide "now playing" recording). */
  onStart?: () => void;
}

export default function VersePlayButton(props: VersePlayButtonProps) {
  const { book, chapter, translationId } = props;
  const chapterRefs = useMemo(() => [{ book, chapter, translationId }], [book, chapter, translationId]);
  const library = useLibraryTimings(chapterRefs);
  const key = libraryTimingsKey(translationId, book, chapter);
  const audio = resolveVerseAudio(
    props.userRecordings,
    props.selectedChapterAudios,
    book,
    chapter,
    props.verse,
    translationId,
    key ? library.get(key) : null
  );
  const url = resolvePlaybackUrl(audio?.recording, props.studioPlaybackEnabled, props.audioCacheMap);
  const space = useScaledSpace();
  if (!audio || !url) return null;
  return (
    <View style={{ gap: space(4) }}>
      <Player url={url} startSec={audio.startSec} endSec={audio.endSec} onStart={props.onStart} />
      {isLibraryRecording(audio.recording) && <LibraryCredit />}
    </View>
  );
}

/** The licence's attribution, wherever the built-in reading plays. */
export function LibraryCredit() {
  return (
    <Pressable onPress={() => Linking.openURL(LIBRARY_READER.licenseUrl)} accessibilityRole="link">
      <AppText variant="caption" className="font-sans text-ink-3">
        {LIBRARY_READER.credit}
      </AppText>
    </Pressable>
  );
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
