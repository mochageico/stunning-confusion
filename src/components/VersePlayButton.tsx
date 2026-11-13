import { useEffect, useMemo, useRef, useState } from 'react';
import { Linking, Pressable, View } from 'react-native';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { Pause, Play } from 'lucide-react-native';

import { Recording } from '../types';
import { AppButton, AppText, useScaledSpace } from './design';
import {
  LibraryReader,
  libraryReaderFor,
  libraryReaderOf,
  libraryRecording,
  libraryTimingsKey,
  resolveVerseAudio,
} from '../lib/libraryAudio';
import { resolvePlaybackUrl } from '../lib/studioAudio';
import { useLibraryTimings } from '../state/useLibraryAudio';

// ============================================================================
// VERSE PLAY BUTTON
// ----------------------------------------------------------------------------
// Plays one verse from the user's own recording of its chapter: seeks to the
// verse's tagged start and pauses at its end. Renders nothing when there is no
// recording, or the recording has no timing for this verse -- there is no
// text-to-speech fallback in the app. BSB verses and Hebrew Old Testament
// verses fall back to the built-in reading (see lib/libraryAudio.ts).
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
      <LibraryCredit reader={libraryReaderOf(audio.recording)} />
    </View>
  );
}

/** The reading's credit and licence, wherever a built-in reading plays. Nothing for the user's own recordings. */
export function LibraryCredit({ reader }: { reader: LibraryReader | null }) {
  if (!reader) return null;
  return (
    <Pressable onPress={() => Linking.openURL(reader.licenseUrl)} accessibilityRole="link">
      <AppText variant="caption" className="font-sans text-ink-3">
        {reader.credit}
      </AppText>
    </Pressable>
  );
}

/**
 * A passage's built-in reading as one Play button, e.g. right after setup adds
 * someone's first verses. Plays the verses start..end as long as they run on
 * in one file (always, for BSB). Nothing when the translation has no reading
 * or its timings haven't loaded.
 */
export function PassagePreview(props: { translationId: string; book: string; chapter: number; startVerse: number; endVerse: number; label?: string }) {
  const { translationId, book, chapter, startVerse, endVerse } = props;
  const refs = useMemo(() => [{ book, chapter, translationId }], [book, chapter, translationId]);
  const timingsMap = useLibraryTimings(refs);
  const space = useScaledSpace();
  const reader = libraryReaderFor(translationId, book);
  const key = libraryTimingsKey(translationId, book, chapter);
  const timings = key ? timingsMap.get(key) : undefined;
  const first = timings?.verses[String(startVerse)];
  if (!reader || !timings || !first) return null;
  let endSec = first.endSec;
  for (let v = startVerse + 1; v <= endVerse; v++) {
    const t = timings.verses[String(v)];
    if (!t || t.file !== first.file) break;
    endSec = t.endSec;
  }
  const url = libraryRecording(reader, book, timings, first.file).audioUrl;
  if (!url) return null;
  return (
    <View style={{ gap: space(4) }}>
      <Player url={url} startSec={first.startSec} endSec={endSec} label={props.label} />
      <LibraryCredit reader={reader} />
    </View>
  );
}

function Player({ url, startSec, endSec, onStart, label }: { url: string; startSec: number; endSec: number; onStart?: () => void; label?: string }) {
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

  return <AppButton variant="secondary" Icon={playing ? Pause : Play} label={playing ? 'Pause' : label ?? 'Play'} onPress={playing ? stop : start} />;
}
