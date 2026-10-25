import { ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { ChevronDown, Pause, Play } from 'lucide-react-native';

import { AppIconButton, AppText, useFontScale, useScaledSpace } from './design';
import { useThemeColors } from './theme';
import { LibraryCredit } from './VersePlayButton';
import { LIBRARY_READER, LibraryChapterTimings, libraryRecording } from '../lib/libraryAudio';

// ============================================================================
// CHAPTER LIBRARY PLAYER
// ----------------------------------------------------------------------------
// The chapter page's player for the built-in Hebrew reading. It plays exactly
// this chapter's verses: Hebrew and English chapters don't always line up, so
// about 70 chapters start or end partway through a Hebrew file, or run across
// two (English Joel 2 is Hebrew Joel 2 plus the start of Hebrew Joel 3). The
// verses are grouped into runs, one per file, played back to back.
// ============================================================================

interface Run {
  url: string;
  startSec: number;
  endSec: number;
}

/** This chapter's verses as back-to-back runs, one per stretch of a file. */
export function chapterRuns(book: string, timings: LibraryChapterTimings, audioCacheMap?: ReadonlyMap<string, string>): Run[] {
  const runs: (Run & { file: string })[] = [];
  const verses = Object.entries(timings.verses).sort(([a], [b]) => Number(a) - Number(b));
  for (const [, t] of verses) {
    const last = runs[runs.length - 1];
    if (last && last.file === t.file) {
      last.startSec = Math.min(last.startSec, t.startSec);
      last.endSec = Math.max(last.endSec, t.endSec);
      continue;
    }
    const rec = libraryRecording(book, timings, t.file);
    const url = audioCacheMap?.get(rec.audioPath ?? '') ?? rec.audioUrl ?? '';
    runs.push({ file: t.file, url, startSec: t.startSec, endSec: t.endSec });
  }
  return runs;
}

const formatTime = (sec: number) => {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

export interface ChapterLibraryPlayerProps {
  book: string;
  timings: LibraryChapterTimings;
  audioCacheMap?: ReadonlyMap<string, string>;
  /** Stops the app-wide "now playing" recording when this starts. */
  onStart: () => void;
  /** True while something else plays; this player stops. */
  suspended: boolean;
  /** Tapping the name, e.g. to switch to one of the user's own recordings. */
  onPressTitle?: () => void;
  titleExpanded?: boolean;
  /** Rendered at the end of the row (the chapter card's photo strip). */
  trailing?: ReactNode;
}

export default function ChapterLibraryPlayer({
  book,
  timings,
  audioCacheMap,
  onStart,
  suspended,
  onPressTitle,
  titleExpanded,
  trailing,
}: ChapterLibraryPlayerProps) {
  const palette = useThemeColors();
  const scale = useFontScale();
  const space = useScaledSpace();

  const runs = useMemo(() => chapterRuns(book, timings, audioCacheMap), [book, timings, audioCacheMap]);
  const total = runs.reduce((sum, r) => sum + (r.endSec - r.startSec), 0);

  const player = useAudioPlayer(runs[0]?.url ?? null);
  const sourceRef = useRef(runs[0]?.url ?? '');
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const runIndex = useRef(0);
  // A run waiting for its file to load before it can seek.
  const pendingRun = useRef<number | null>(null);
  // Only true once the seek has resolved, and `landed` once a status has
  // actually reported a playhead inside the run: right after a seek (or a
  // file switch) the status can still carry the old position, past endSec,
  // which would end the run the moment it starts.
  const armed = useRef(false);
  const landed = useRef(false);

  const doneBefore = (i: number) => runs.slice(0, i).reduce((sum, r) => sum + (r.endSec - r.startSec), 0);

  const seekAndPlay = (i: number) => {
    pendingRun.current = null;
    landed.current = false;
    player.seekTo(runs[i].startSec).then(() => {
      armed.current = true;
      player.play();
    });
  };

  const beginRun = (i: number) => {
    runIndex.current = i;
    armed.current = false;
    if (sourceRef.current !== runs[i].url) {
      sourceRef.current = runs[i].url;
      pendingRun.current = i;
      player.replace({ uri: runs[i].url });
    } else if (player.isLoaded) {
      seekAndPlay(i);
    } else {
      pendingRun.current = i;
    }
  };

  const stop = () => {
    armed.current = false;
    pendingRun.current = null;
    try {
      player.pause();
    } catch {
      // already released -- nothing to pause
    }
    setPlaying(false);
  };

  useEffect(() => {
    const sub = player.addListener('playbackStatusUpdate', (status) => {
      if (pendingRun.current !== null) {
        if (status.isLoaded) seekAndPlay(pendingRun.current);
        return;
      }
      if (!armed.current) return;
      const i = runIndex.current;
      const run = runs[i];
      if (!landed.current) {
        if (status.currentTime < run.startSec - 0.5 || status.currentTime >= run.endSec) return;
        landed.current = true;
      }
      setElapsed(doneBefore(i) + Math.max(0, Math.min(status.currentTime, run.endSec) - run.startSec));
      // A file's last verse ends with the file, a fraction before endSec.
      const atEnd =
        status.didJustFinish ||
        status.currentTime >= run.endSec - 0.05 ||
        (status.duration > 0 && status.currentTime >= status.duration - 0.15);
      if (!atEnd) return;
      if (i + 1 < runs.length) {
        beginRun(i + 1);
      } else {
        stop();
        setElapsed(0);
      }
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player, runs]);

  // Another chapter or translation: start over.
  useEffect(() => {
    stop();
    setElapsed(0);
    runIndex.current = 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runs]);

  useEffect(() => {
    if (suspended && playing) stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suspended]);

  const start = () => {
    if (runs.length === 0) return;
    onStart();
    setPlaying(true);
    setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true, shouldPlayInBackground: false, interruptionMode: 'doNotMix' }).catch(() => {});
    // Resume where it paused; from the top when it had finished or never started.
    if (elapsed > 0 && sourceRef.current === runs[runIndex.current].url && player.isLoaded) {
      armed.current = true;
      player.play();
    } else {
      beginRun(elapsed > 0 ? runIndex.current : 0);
    }
  };

  const title = `Hebrew reading · ${LIBRARY_READER.name}`;
  const name = (
    <>
      <View className="flex-row items-center" style={{ gap: space(4) }}>
        <AppText variant="label" className="font-sans font-semibold text-ink shrink" numberOfLines={1}>
          {title}
        </AppText>
        {onPressTitle && <ChevronDown size={Math.round(13 * scale)} color={palette.ink3} strokeWidth={2.4} />}
      </View>
      <AppText variant="caption" className="font-sans text-ink-3" numberOfLines={1}>
        Built in · Hebrew
      </AppText>
    </>
  );

  return (
    <View style={{ gap: space(10) }}>
      <View className="flex-row items-center" style={{ gap: space(10) }}>
        <AppIconButton
          variant="filled"
          Icon={playing ? Pause : Play}
          diameter={34}
          accessibilityLabel={playing ? 'Pause' : `Play ${title}`}
          onPress={playing ? stop : start}
        />
        {onPressTitle ? (
          <Pressable
            onPress={onPressTitle}
            accessibilityRole="button"
            accessibilityLabel={`${title}. Change recording`}
            accessibilityState={{ expanded: !!titleExpanded }}
            className="flex-1 active:opacity-60"
            style={{ minWidth: 0 }}
          >
            {name}
          </Pressable>
        ) : (
          <View className="flex-1" style={{ minWidth: 0 }}>
            {name}
          </View>
        )}
        {trailing}
      </View>

      {(playing || elapsed > 0) && (
        <View style={{ gap: space(4) }}>
          <View className="w-full bg-fill h-1 rounded-full overflow-hidden">
            <View className="bg-accent h-full" style={{ width: `${total > 0 ? Math.min(100, (elapsed / total) * 100) : 0}%` }} />
          </View>
          <View className="flex-row justify-between">
            <AppText variant="caption" className="font-sans text-ink-3" style={{ fontVariant: ['tabular-nums'] }}>
              {formatTime(elapsed)}
            </AppText>
            <AppText variant="caption" className="font-sans text-ink-3" style={{ fontVariant: ['tabular-nums'] }}>
              {formatTime(total)}
            </AppText>
          </View>
        </View>
      )}

      {/* The licence requires the credit wherever the reading plays. */}
      <LibraryCredit />
    </View>
  );
}
