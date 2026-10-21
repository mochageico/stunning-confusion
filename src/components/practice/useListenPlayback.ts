import { useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { setAudioModeAsync, useAudioPlayer, type AudioPlayer, type AudioStatus } from 'expo-audio';
import { hasPlayableAudio, resolvePlaybackUrl } from '../../lib/studioAudio';
import { VerseState, QueueItem, Recording, ChapterPhoto } from '../../types';
import { resolveChapterAudio, isReviewDue } from '../../state/useAppState';
import { chapterPhotoKey, sortChapterPhotos } from '../../lib/chapterPhotos';
import { groupPassages } from './shared';

// ============================================================================
// LISTEN PLAYBACK
// ----------------------------------------------------------------------------
// Everything behind the practice screen's Listen mode: which verses play, the
// player and its verse-boundary handling, repeats, lock-screen controls and the
// Bible-page photo for the verse playing. PracticeModals calls this before
// useRecall, every render, in either mode. Split out of PracticeModals.tsx
// (see .claude/file-split-plan.md).
// ============================================================================

export interface UseListenPlaybackParams {
  type: 'listen' | 'learn';
  verses: VerseState[];
  allVerses?: VerseState[];
  memoryQueue?: QueueItem[];
  primingLookahead: number;
  reviewsPaused: boolean;
  userRecordings: Recording[];
  selectedChapterAudios: Record<string, Recording | null>;
  studioPlaybackEnabled: boolean;
  audioCacheMap?: ReadonlyMap<string, string>;
  onCacheAudio?: (recording: Recording) => void;
  onListenPlayingChange?: (playing: boolean) => void;
  playingRecordingId: string | null;
  setPlayingRecordingId?: (id: string | null) => void;
  chapterPhotos?: ChapterPhoto[];
}

export function useListenPlayback({
  type,
  verses,
  allVerses,
  memoryQueue,
  primingLookahead,
  reviewsPaused,
  userRecordings,
  selectedChapterAudios,
  studioPlaybackEnabled,
  audioCacheMap,
  onCacheAudio,
  onListenPlayingChange,
  playingRecordingId,
  setPlayingRecordingId,
  chapterPhotos,
}: UseListenPlaybackParams) {
  // ==========================================
  // PLAYLIST / PLAY-SOURCE STATE (Listen mode only)
  // ==========================================
  const [playSource, setPlaySource] = useState<'selection' | 'memorization' | 'reviewing' | 'priming' | 'all'>('selection');

  const [activePlayVerses, setActivePlayVerses] = useState<VerseState[]>(verses);

  // "Verse by Verse" (existing card list) vs "Memory Grid" -- purely a
  // display choice, doesn't affect playback state at all. Tapping a grid
  // box calls the exact same handleVerseClick used by the card list.
  const [listenViewMode, setListenViewMode] = useState<'verses' | 'memoryGrid' | 'photo'>('verses');

  // Segment selection states — indices into activePlayVerses (verse
  // granularity; word-level selection was removed, see Listen mode below).
  const [selectionStart, setSelectionStart] = useState<number | null>(null);

  const [selectionEnd, setSelectionEnd] = useState<number | null>(null);

  // Sync / load different playlists based on selected source
  useEffect(() => {
    if (playSource === 'selection') {
      setActivePlayVerses(verses);
    } else {
      let dbLearning: VerseState[] = [];
      let dbReviewing: VerseState[] = [];
      let dbPriming: VerseState[] = [];

      if (memoryQueue && memoryQueue.length > 0) {
        const mapQueueItemToVerse = (item: QueueItem): VerseState => ({
          book: item.book,
          chapter: item.chapter,
          verse: item.verseNumber,
          text: item.text,
          status: item.status === 'retained' ? 'memorized' : 'learning',
          // Playlists mix translations, so each verse carries its own.
          translationId: item.translationId || 'ESV',
        });

        dbLearning = memoryQueue.filter((item) => item.status === 'learning').map(mapQueueItemToVerse);
        // Today's whole review set: still due, or already reviewed today. A
        // verse shouldn't vanish from the playlist the moment it's reviewed.
        const today = new Date().toDateString();
        const reviewedToday = (iso: string | null) => !!iso && new Date(iso).toDateString() === today;
        dbReviewing = reviewsPaused ? [] : memoryQueue
          .filter((item) => item.status === 'reviewing' && (isReviewDue(item.nextReviewDueDate) || reviewedToday(item.lastReviewDate)))
          .map(mapQueueItemToVerse);
        dbPriming = memoryQueue.filter((item) => item.status === 'queued').slice(0, primingLookahead).map(mapQueueItemToVerse);
      } else {
        // Fallback
        dbLearning = (allVerses || []).filter((v) => v.book === 'Genesis' && v.chapter === 1 && (v.verse === 3 || v.verse === 4 || v.verse === 5 || v.verse === 6));
        dbReviewing = (allVerses || []).filter((v) => (v.book === 'Romans' && v.chapter === 8 && (v.verse === 1 || v.verse === 2)) || (v.book === 'John' && v.chapter === 15));
        dbPriming = (allVerses || []).filter((v) => (v.book === 'Genesis' && v.chapter === 1 && v.verse >= 7) || (v.book === 'Genesis' && v.chapter === 2));
      }

      if (playSource === 'memorization') {
        setActivePlayVerses(dbLearning.length > 0 ? groupPassages(dbLearning) : verses);
      } else if (playSource === 'reviewing') {
        setActivePlayVerses(dbReviewing.length > 0 ? groupPassages(dbReviewing) : verses);
      } else if (playSource === 'priming') {
        setActivePlayVerses(dbPriming.length > 0 ? groupPassages(dbPriming) : verses);
      } else if (playSource === 'all') {
        // "Today's Verses" -- everything actually relevant today (still
        // being learned, due for review, or coming up in the priming
        // lookahead), NOT the entire cached Bible text. A QueueItem only
        // ever has one status at a time, so these three lists are already
        // mutually exclusive -- no dedup needed. Grouping merges across the
        // three, so Isaiah 55:1-8 under review plays straight into 55:9
        // being learned.
        const dbToday = groupPassages([...dbLearning, ...dbReviewing, ...dbPriming]);
        setActivePlayVerses(dbToday.length > 0 ? dbToday : verses);
      }
    }
    // Reset playback position back to the first verse
    setCurrentVerseIndex(0);
    setSelectionStart(null);
    setSelectionEnd(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playSource, verses, allVerses, memoryQueue, primingLookahead, reviewsPaused]);

  // Header reference text
  const referenceText = useMemo(() => {
    const targetVerses = type === 'learn' ? verses : activePlayVerses;

    if (targetVerses.length === 0) return 'No verses selected';
    if (targetVerses.length === 1) {
      return `${targetVerses[0].book} ${targetVerses[0].chapter}:${targetVerses[0].verse}`;
    }
    const first = targetVerses[0];
    const last = targetVerses[targetVerses.length - 1];

    // Check if they are in the same chapter
    if (first.book === last.book && first.chapter === last.chapter) {
      return `${first.book} ${first.chapter}:${first.verse}-${last.verse}`;
    }
    return `${first.book} ${first.chapter}:${first.verse} - ${last.book} ${last.chapter}:${last.verse}`;
  }, [type, verses, activePlayVerses]);

  // ==========================================
  // LISTEN MODE — real verse-by-verse audio playback. No word-level
  // highlighting: word timing was always simulated (a fixed WPM guess), and
  // the only real timing data this app has is per-VERSE (verseTimestamps),
  // so that's the granularity this mode actually plays and highlights at.
  // ==========================================
  const [listenPlaying, setListenPlaying] = useState(false);

  const [listenSpeed, setListenSpeed] = useState(1.0);

  const [currentVerseIndex, setCurrentVerseIndex] = useState(0);

  const [repeatMode, setRepeatMode] = useState<'off' | 'playlist'>('playlist'); // default to loop playlist

  // How many times each verse plays before playback moves on -- 15, 15, 15,
  // then 16, 16, 16. A separate axis from repeatMode above, which only
  // decides what happens once the whole list has played through. Session-
  // local like listenSpeed: every Listen session opens back at 1x, so nobody
  // ever wonders why a verse is repeating itself.
  const [repeatsPerVerse, setRepeatsPerVerse] = useState(1);

  const [verseRepeatsDone, setVerseRepeatsDone] = useState(0);

  // Which settings pill has its choices expanded beneath it, if any. Speed
  // and repeats are the only two with more than an on/off to say; the
  // end-of-list pill just toggles. Only one opens at a time because they
  // share one row of space -- not because the others are being hidden from
  // you: whatever is set is always readable on the pill itself.
  const [openSetting, setOpenSetting] = useState<'speed' | 'repeats' | null>(null);

  // Auto-follow: the reading pane scrolls itself so the verse being played
  // stays on screen. On by default; scrolling by hand DURING playback turns
  // it off (the user is deliberately reading somewhere else), and only the
  // Follow button turns it back on.
  const [autoFollow, setAutoFollow] = useState(true);

  const verseListRef = useRef<ScrollView>(null);

  // Geometry is read on demand with .measureLayout(), NOT collected from
  // onLayout: onLayout does not fire on this app's Views (the same finding
  // already recorded on the range slider in ui.tsx), so an offsets map filled
  // in by onLayout stays empty forever and Follow silently never scrolls.
  // Verified in the browser: it did exactly that.
  const verseContentRef = useRef<View>(null);

  const verseCardRefs = useRef<Record<number, View | null>>({});

  // For every verse in the active playlist, resolve which real recording (if
  // any) covers it and that recording's tagged {startSec, endSec} for this
  // specific verse. A verse with no matching recording, or a recording with
  // no verseTimestamps entry for it, simply has no segment -- it's still
  // shown in the reading pane (so the list doesn't mysteriously skip verses)
  // but playback skips over it, since there's nothing to play.
  const playableSegments = useMemo(() => {
    return activePlayVerses.map((verseObj) => {
      const recording = resolveChapterAudio(userRecordings, selectedChapterAudios, verseObj.book, verseObj.chapter);
      // hasPlayableAudio rather than a raw audioUrl check — verse timestamps
      // are equally valid against the studio render, since processing is
      // duration-preserving (enforced by the guard in processStudioAudio).
      const vt = hasPlayableAudio(recording) ? recording!.verseTimestamps?.find((t) => t.verse === verseObj.verse) : undefined;
      return vt ? { verseObj, recording: recording!, startSec: vt.startSec, endSec: vt.endSec } : { verseObj, recording: null, startSec: null, endSec: null };
    });
  }, [activePlayVerses, userRecordings, selectedChapterAudios]);

  // Indices (into activePlayVerses/playableSegments) that actually have
  // audio -- the only ones playback ever lands on.
  const playableIndices = useMemo(
    () => playableSegments.map((s, i) => (s.recording ? i : -1)).filter((i) => i >= 0),
    [playableSegments]
  );

  const hasAnyAudio = playableIndices.length > 0;

  const currentSegment = playableSegments[currentVerseIndex] ?? null;

  // ---- Bible page photos ------------------------------------------------
  // Resolution is (CHAPTER, verse) -> photo, not verse -> photo. A Listen
  // session launched from Home routinely spans several chapters, so this has to
  // re-resolve against whichever chapter the current verse actually belongs to
  // -- otherwise the page on screen quietly stops matching the audio.
  // The verse playback is actually on. Named for what it is rather than for
  // the photo layer, because the lock screen needs exactly the same thing.
  const nowPlayingVerse = currentSegment?.verseObj ?? activePlayVerses[currentVerseIndex] ?? null;

  const photoVerse = nowPlayingVerse;

  const photoChapterKey = photoVerse ? chapterPhotoKey(photoVerse.book, photoVerse.chapter) : null;

  const photosForCurrentChapter = useMemo(
    () =>
      photoChapterKey && chapterPhotos
        ? sortChapterPhotos(chapterPhotos.filter((photo) => photo.chapterKey === photoChapterKey))
        : [],
    [chapterPhotos, photoChapterKey]
  );

  // The Display option appears when ANY chapter in the session has a photo, not
  // only when the current one does. Otherwise a mixed queue hides the option for
  // the whole session because one chapter in it happens to lack a page.
  const sessionHasPhotos = useMemo(() => {
    if (!chapterPhotos?.length) return false;
    const keys = new Set(activePlayVerses.map((v) => chapterPhotoKey(v.book, v.chapter)));
    return chapterPhotos.some((photo) => keys.has(photo.chapterKey));
  }, [chapterPhotos, activePlayVerses]);

  // Deleting the session's last photo elsewhere would otherwise strand the user
  // on a Display mode whose option no longer exists in the dropdown.
  useEffect(() => {
    if (listenViewMode === 'photo' && !sessionHasPhotos) setListenViewMode('verses');
  }, [listenViewMode, sessionHasPhotos]);

  // Keep the playing verse on screen. Only the card list is followed: the
  // memory grid is compact enough not to need it, and the photo view doesn't
  // scroll by verse at all. Re-arming Follow re-runs this too, so the button
  // immediately brings you back to whatever is playing.
  //
  // measureLayout against the content wrapper gives the card's offset INSIDE
  // the scrollable content -- exactly the number scrollTo wants, with no need
  // to track the current scroll position. The rAF retry mirrors ui.tsx's
  // slider: for a frame or two after a view switch or a playlist change there
  // is nothing laid out to measure yet.
  useEffect(() => {
    if (type !== 'listen' || !autoFollow || listenViewMode !== 'verses') return;
    let frame = 0;
    let cancelled = false;
    const attempt = (triesLeft: number) => {
      if (cancelled) return;
      const retry = () => {
        if (triesLeft > 0) frame = requestAnimationFrame(() => attempt(triesLeft - 1));
      };
      const card = verseCardRefs.current[currentVerseIndex];
      const content = verseContentRef.current;
      if (!card || !content) {
        retry();
        return;
      }
      card.measureLayout(
        content as never,
        (_x, y) => {
          if (!cancelled) verseListRef.current?.scrollTo({ y: Math.max(0, y - 12), animated: true });
        },
        () => retry()
      );
    };
    attempt(20);
    return () => {
      cancelled = true;
      if (frame) cancelAnimationFrame(frame);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, autoFollow, listenViewMode, currentVerseIndex]);

  // Real audio player for whichever recording covers the current verse.
  // Swapping to a different chapter's recording (or none) just means this
  // source string changes -- expo-audio reloads automatically, same pattern
  // as recordingPlayer/importPlayer elsewhere in this app. Deliberately its
  // own player rather than reusing the app-wide "now playing" system: Listen
  // mode auto-advances across verses (and can switch recordings on its own),
  // which shouldn't hijack whatever the floating mini-bar is doing elsewhere.
  // updateInterval matters more here than anywhere else in the app. Every
  // verse boundary is detected by watching status.currentTime cross the
  // tagged endSec, so the boundary can only ever be noticed on a status tick
  // -- at expo-audio's 500ms default that means overshooting the end of a
  // verse by up to half a second. For ordinary playback that's invisible (the
  // audio flows straight into the next verse anyway), but when a verse is
  // looping -- a selected segment, or repeats-per-verse -- the overshoot is
  // the beginning of the NEXT verse, audibly played before the loop snaps
  // back. 100ms puts the boundary where the user expects it.
  //
  // This rate is only affordable because nothing in this component re-renders
  // on a tick any more -- see ListenProgress (./shared) and the subscription below.
  const listenPlayer = useAudioPlayer(
    resolvePlaybackUrl(currentSegment?.recording, studioPlaybackEnabled, audioCacheMap),
    { updateInterval: 100 }
  );

  // Deliberately NOT useAudioPlayerStatus. That hook stores the whole status
  // in React state, so calling it here re-rendered this entire component --
  // the full verse list included -- ten times a second, just to move a
  // progress bar. Verse boundaries were then detected inside an effect that
  // only ran as part of those renders, so once the JS thread fell behind,
  // detection fell behind with it: verse 2's audio played for seconds while
  // the screen still showed verse 1, then the advance finally landed, the
  // seek below saw a playhead far past verse 2's start and yanked it
  // backwards -- restarting a verse that was already halfway through.
  //
  // Boundary detection now runs in the player's own event callback, off the
  // render path entirely, and cannot be delayed by rendering at all. Only
  // isLoaded reaches React state, and only when it actually changes.
  const [listenLoaded, setListenLoaded] = useState(false);

  // Reassigned after every render (below) so this long-lived listener always
  // runs against current state without needing to be re-subscribed.
  const onStatusTickRef = useRef<(status: AudioStatus) => void>(() => {});

  useEffect(() => {
    setListenLoaded(listenPlayer.currentStatus?.isLoaded ?? false);
    const subscription = listenPlayer.addListener('playbackStatusUpdate', (status) => {
      // Returning the identical value makes React bail out without
      // re-rendering, so this costs nothing on the ticks where nothing
      // changed -- which is all but two of them.
      setListenLoaded((was) => (was === status.isLoaded ? was : status.isLoaded));
      onStatusTickRef.current(status);
    });
    return () => subscription.remove();
  }, [listenPlayer]);

  // ---- Lock screen / Control Centre ------------------------------------
  // What the OS shows while the phone is locked: the verse being spoken, and
  // underneath it whichever recording is being played.
  const lockScreenMetadata = useMemo(
    () => ({
      title: nowPlayingVerse
        ? `${nowPlayingVerse.book} ${nowPlayingVerse.chapter}:${nowPlayingVerse.verse}`
        : referenceText,
      artist: currentSegment?.recording?.title ?? 'Scripture Memory',
      albumTitle: referenceText,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [nowPlayingVerse?.book, nowPlayingVerse?.chapter, nowPlayingVerse?.verse, currentSegment?.recording?.title, referenceText]
  );

  // Claim the controls the first time this session actually plays -- not the
  // moment Listen opens, which would park a silent "now playing" card on the
  // lock screen for someone who is only reading.
  //
  // Claiming is per PLAYER, and useAudioPlayer builds a new one whenever the
  // source changes, so a session spanning two chapters has to re-claim on the
  // swap; hence tracking which player holds it rather than a bare boolean.
  //
  // Deliberately never released on pause: releasing it would take the
  // controls away at exactly the moment the user needs them to press play
  // again. Only unmount clears it.
  const lockScreenPlayerRef = useRef<AudioPlayer | null>(null);

  useEffect(() => {
    if (type !== 'listen' || !listenPlaying || !listenLoaded) return;
    if (lockScreenPlayerRef.current === listenPlayer) {
      listenPlayer.updateLockScreenMetadata(lockScreenMetadata);
      return;
    }
    lockScreenPlayerRef.current = listenPlayer;
    // Seek buttons stay off: they would move the playhead ten seconds at a
    // time with no regard for verse boundaries. The scrub bar is left on, and
    // handleStatusTick below follows it to whichever verse it lands in.
    listenPlayer.setActiveForLockScreen(true, lockScreenMetadata, {
      showSeekForward: false,
      showSeekBackward: false,
    });
  }, [type, listenPlaying, listenLoaded, listenPlayer, lockScreenMetadata]);

  useEffect(() => {
    return () => {
      try {
        lockScreenPlayerRef.current?.clearLockScreenControls();
      } catch {
        // already released
      }
    };
  }, []);

  // Report playback state up so useAppState knows not to swap any player's
  // source while Listen is mid-recitation, and ask for whatever recording is
  // playing to be cached. Both are no-ops after the first time for a given
  // file; the cache module de-dupes.
  useEffect(() => {
    onListenPlayingChange?.(listenPlaying);
  }, [listenPlaying, onListenPlayingChange]);

  useEffect(() => {
    return () => onListenPlayingChange?.(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!listenPlaying || !currentSegment?.recording) return;
    onCacheAudio?.(currentSegment.recording);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listenPlaying, currentSegment?.recording]);

  useEffect(() => {
    return () => {
      try {
        listenPlayer.pause();
      } catch {
        // already released
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Audio session for Listen playback. Both of the additions here are load-
  // bearing for locked-screen listening, not preferences:
  //
  // - shouldPlayInBackground is what keeps audio running once the app leaves
  //   the foreground at all. The native side of it is already in place --
  //   expo-audio's config plugin defaults enableBackgroundPlayback to true,
  //   so the build already carries UIBackgroundModes: ['audio'] and Android's
  //   mediaPlayback foreground service.
  // - interruptionMode must be 'doNotMix' or the OS may decline to hand this
  //   player the lock screen controls at all (expo-audio's own requirement
  //   for setActiveForLockScreen). It also means starting a Listen session
  //   now stops whatever else was playing, rather than talking over it --
  //   which is the right behaviour for a recitation you are trying to follow.
  //
  // NOTE: the audio session is global, and useAppState resets it to a
  // foreground-only mode after recording/importing. Those paths all stop
  // Listen first (the one-source-at-a-time effect below), so they can't strip
  // background mode from a session that is still playing.
  useEffect(() => {
    if (listenPlaying) {
      setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        shouldPlayInBackground: true,
        interruptionMode: 'doNotMix',
      }).catch(() => {});
    }
  }, [listenPlaying]);

  // One audio source at a time -- Listen mode and the app-wide saved-
  // recording "now playing" system (Profile/RecordingDetail/etc's mini-bar)
  // are otherwise fully independent, so without this a user could end up
  // with two playbacks running simultaneously. Starting either one cancels
  // (pauses) the other, in both directions:
  useEffect(() => {
    // Listen just started playing -- stop whatever saved recording was
    // already playing elsewhere. A no-op if nothing was playing.
    if (listenPlaying) setPlayingRecordingId?.(null);
  }, [listenPlaying, setPlayingRecordingId]);

  useEffect(() => {
    // A saved recording just started playing elsewhere while Listen mode
    // was actively playing -- pause Listen's playback (not a full close;
    // the overlay/mini-bar stays exactly as it was, just paused, so it can
    // be resumed manually).
    if (playingRecordingId && listenPlaying) {
      try {
        listenPlayer.pause();
      } catch {
        // already released
      }
      setListenPlaying(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playingRecordingId]);

  // Finds the next playable index after `from`, restricted to the active
  // selection range when one is set. Returns null if there's nowhere to go
  // (caller decides whether that means "loop back to the start" or "stop").
  const findNextPlayableIndex = (from: number): number | null => {
    const inRange = (i: number) => {
      if (!(playSource === 'selection' && selectionStart !== null)) return true;
      const end = selectionEnd ?? selectionStart;
      return i >= selectionStart && i <= end;
    };
    const candidates = playableIndices.filter(inRange);
    if (candidates.length === 0) return null;
    const next = candidates.find((i) => i > from);
    return next !== undefined ? next : null;
  };

  const firstPlayableIndexInRange = (): number => {
    const inRange = (i: number) => {
      if (!(playSource === 'selection' && selectionStart !== null)) return true;
      const end = selectionEnd ?? selectionStart;
      return i >= selectionStart && i <= end;
    };
    return playableIndices.filter(inRange)[0] ?? 0;
  };

  // Guards against a race that showed up specifically on LOOPING BACK to an
  // earlier verse (e.g. a 1-3 selection finishing verse 3 and returning to
  // verse 1): looping back seeks to an EARLIER position within the same
  // still-loaded recording, but the player status can keep reporting the
  // old, later currentTime (verse 3's, well past verse 1's endSec) for a
  // beat before the seek actually takes effect. Without this guard, the
  // end-of-segment check below saw that stale/still-later currentTime, read
  // it as "verse 1 already finished" instantly, and skipped straight to
  // verse 2 -- verse 1 would flash for a fraction of a second and never
  // really play. Forward advances never hit this, since a stale slightly-
  // behind currentTime is harmless against a LATER segment's endSec -- only
  // seeking backward exposes it.
  const seekedToCurrentSegmentRef = useRef(false);

  // Set while a repeats-per-verse replay has seeked back to this same
  // segment's start and we're still waiting for the status to catch up. It is
  // NOT enough to re-arm on seekTo's promise: resolving the seek does not mean
  // the next status tick reflects the new position, and a stale reading still
  // sitting past endSec reads as "this pass finished too" -- which would burn
  // every remaining repeat in one go. seekedToCurrentSegmentRef can't cover
  // this on its own because, unlike a verse change, currentVerseIndex never
  // changes here.
  const repeatSeekPendingRef = useRef(false);

  // When this component last commanded the player itself. The remote-transport
  // sync in handleStatusTick ignores disagreements newer than this, so our own
  // in-flight play/pause/seek is never mistaken for someone pressing a button
  // on their headphones.
  const lastTransportCommandRef = useRef(0);

  const markTransportCommand = () => {
    lastTransportCommandRef.current = Date.now();
  };

  useEffect(() => {
    seekedToCurrentSegmentRef.current = false;
    repeatSeekPendingRef.current = false;
    setVerseRepeatsDone(0);
  }, [currentVerseIndex]);

  // Once the (possibly just-swapped) player has finished loading this verse's
  // recording, cue up its start position. Fires on every verse change --
  // when consecutive verses share the same recording the player is already
  // loaded, so this seeks immediately; when the recording changes, it waits
  // for isLoaded to flip true after the reload.
  //
  // IMPORTANT: skip the seek entirely when we're already essentially at this
  // segment's start. Verse boundaries within one recording are contiguous by
  // construction (buildVerseTimestamps sets a verse's endSec to the exact
  // timestamp the next verse's startSec uses), so the ordinary case of
  // advancing to the next verse in a continuously-playing recording needs no
  // seek at all -- the audio is already flowing straight into it. Seeking
  // anyway (even to a position we're already at) produced an audible
  // stutter: seekTo is async, so by the time it actually lands, real
  // playback has usually already continued a beat past that exact instant,
  // and the seek yanks it back, replaying the start of the verse that had
  // already begun. A genuine jump (switching recordings, looping back to the
  // start, restarting, manually selecting a verse) still seeks normally.
  useEffect(() => {
    if (type !== 'listen' || !currentSegment?.recording || !listenLoaded) return;
    // "Already there" means anywhere INSIDE this verse, not just within a
    // fraction of a second of its start. If the playhead is already somewhere
    // in the segment we just switched to, the audio is by definition already
    // playing the right verse and seeking could only interrupt it -- most
    // destructively by restarting a verse the listener is halfway through.
    // A genuine jump (different recording, looping back, restarting, tapping
    // a verse) leaves the playhead outside the target and still seeks.
    const playhead = listenPlayer.currentStatus?.currentTime ?? 0;
    const alreadyInsideSegment = playhead >= currentSegment.startSec - 0.35 && playhead < currentSegment.endSec;
    if (alreadyInsideSegment) {
      seekedToCurrentSegmentRef.current = true;
      // ...but "no seek needed" is not the same as "already playing", and the
      // difference is a whole chapter. Crossing into a new one swaps the
      // recording, and useAudioPlayer answers a new source by building a new
      // player -- which arrives loaded, parked at 0, and paused. A chapter's
      // first verse starts at 0 too, so the playhead is legitimately inside
      // the target segment and this shortcut is taken. Returning here would
      // leave that new recording sitting silently at its start forever, since
      // the only play() on this path is the one inside the seek below.
      // Playback simply stopped at every chapter boundary.
      const playing = listenPlayer.currentStatus?.playing ?? false;
      if (listenPlaying && !playing) {
        markTransportCommand();
        listenPlayer.play();
      }
      return;
    }
    markTransportCommand();
    listenPlayer.seekTo(currentSegment.startSec).then(() => {
      seekedToCurrentSegmentRef.current = true;
      markTransportCommand();
      if (listenPlaying) listenPlayer.play();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, currentVerseIndex, currentSegment?.recording?.id, listenLoaded]);

  // Keep the real playback rate in sync with the speed control, including
  // right after a recording (re)loads.
  useEffect(() => {
    if (listenLoaded) listenPlayer.setPlaybackRate(listenSpeed, 'high');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listenSpeed, listenLoaded, currentSegment?.recording?.id]);

  // Play the CURRENT segment again from its own start.
  //
  // Every other jump in this component happens by changing currentVerseIndex
  // and letting the seek effect above react to it. That machinery is useless
  // whenever the target is the verse we are already on -- setting state to the
  // value it already holds re-renders nothing, so no effect re-runs, nothing
  // seeks, and the playhead just carries on into the following verses. Two
  // paths need exactly that: repeats-per-verse, and a playlist loop whose
  // range is a single verse (a one-verse selected segment).
  const replayCurrentSegment = (startSec: number, resume: boolean) => {
    seekedToCurrentSegmentRef.current = false;
    repeatSeekPendingRef.current = true;
    markTransportCommand();
    listenPlayer.seekTo(startSec).then(() => {
      seekedToCurrentSegmentRef.current = true;
      markTransportCommand();
      if (resume) listenPlayer.play();
    });
  };

  // Detects reaching the end of the current verse's segment and advances --
  // to the next verse, possibly switching recordings, or loops/stops at the
  // end of the (possibly selection-restricted) range.
  //
  // Runs from the player's status callback, NOT from a render effect, so it
  // stays on time no matter how busy React is (see the subscription above).
  // It is redefined on every render and stashed in the ref below, which is
  // what keeps the state it closes over current.
  const handleStatusTick = (status: AudioStatus) => {
    if (type !== 'listen') return;

    // The player has run off the end of the file and stopped itself. That is
    // what always happens on a chapter's LAST verse: its endSec is the
    // recording's duration rounded to a whole second (buildVerseTimestamps),
    // which usually lands a fraction PAST the real end, so the ordinary
    // endSec check below can never be met -- the audio stops first.
    const atEndOfFile =
      status.didJustFinish || (status.duration > 0 && status.currentTime >= status.duration - 0.15);

    // Transport pressed from outside the app -- one squeeze of an AirPod, the
    // lock screen, a car stereo. Those commands are handled natively, against
    // the player directly, so React never hears about them and the on-screen
    // button would otherwise keep claiming the opposite of the truth. The
    // player's own reported state is the authority here; adopt it.
    //
    // Guarded four ways so this never fights a transition we started
    // ourselves: not before the current verse has actually been cued, not
    // while the player is still loading or buffering (we legitimately intend
    // to play before it can), and not within a moment of our own
    // play/pause/seek, which takes a beat to show up in the status.
    //
    // That first guard is what makes crossing into a new CHAPTER survive.
    // A new chapter is a new recording, so the player reloads, and a freshly
    // loaded source sits there paused until the seek effect cues it and hits
    // play. The tick announcing isLoaded arrives from the player's own
    // callback, synchronously, before React has re-rendered -- so the seek
    // effect has not run yet, nothing has marked a transport command, and
    // this saw a loaded, not-playing player under a listenPlaying intent of
    // true. It read that as "they pressed pause" and stopped playback at
    // every chapter boundary. seekedToCurrentSegmentRef is false for exactly
    // that window and true once the verse is genuinely cued.
    //
    // Reaching the end of the file is the other stop nobody pressed. Without
    // excluding it, finishing a chapter's last verse read as "they paused" and
    // returned before the advance/loop logic below ever ran -- so a Listen
    // session stopped dead after any set ending on a chapter's last verse, and
    // a whole-chapter loop never looped.
    if (
      seekedToCurrentSegmentRef.current &&
      status.isLoaded &&
      !status.isBuffering &&
      status.playing !== listenPlaying &&
      !(atEndOfFile && !status.playing) &&
      Date.now() - lastTransportCommandRef.current > 800
    ) {
      setListenPlaying(status.playing);
      return;
    }

    if (!listenPlaying || !currentSegment?.recording) return;
    // Don't trust currentTime until we've confirmed the seek to THIS verse's
    // start actually landed (see seekedToCurrentSegmentRef above).
    if (!seekedToCurrentSegmentRef.current) return;

    // Disarm before handing over to the verse-change effects. Ticks arrive on
    // the player's own schedule now, so another one can land before React has
    // committed the new currentVerseIndex -- at which point this callback is
    // still the previous render's closure, still pointed at the verse we just
    // decided to leave. Clearing the ref here makes that tick a no-op instead
    // of a second decision about a verse that is already behind us; the seek
    // effect re-arms it once the new verse is cued.
    const leaveCurrentVerse = (index: number) => {
      seekedToCurrentSegmentRef.current = false;
      setCurrentVerseIndex(index);
    };

    const segmentSpan = Math.max(0.01, currentSegment.endSec - currentSegment.startSec);
    if (repeatSeekPendingRef.current) {
      // Nothing about this segment can be trusted until the status reports the
      // playhead genuinely back near its start (see repeatSeekPendingRef).
      if (status.currentTime <= currentSegment.startSec + Math.min(0.5, segmentSpan / 2)) {
        repeatSeekPendingRef.current = false;
      }
      return;
    }

    // The playhead is somewhere this component did not put it: the lock
    // screen's scrub bar was dragged. Follow it to whichever verse now owns
    // that position rather than fighting it -- without this, dragging the
    // scrubber leaves the highlight stranded on the old verse, and the next
    // boundary check seeks the audio back to it.
    //
    // The 1.5s margin keeps a genuine drag distinct from a status reading
    // that is merely a little stale right after one of our own seeks; an
    // ordinary verse boundary is noticed within about a tick of crossing it.
    const activeRecordingId = currentSegment.recording.id;
    const scrubbedAway =
      status.currentTime < currentSegment.startSec - 1.5 || status.currentTime >= currentSegment.endSec + 1.5;
    if (scrubbedAway) {
      const landedOn = playableSegments.findIndex(
        (segment) =>
          segment.recording?.id === activeRecordingId &&
          segment.startSec !== null &&
          segment.endSec !== null &&
          status.currentTime >= segment.startSec &&
          status.currentTime < segment.endSec
      );
      if (landedOn >= 0 && landedOn !== currentVerseIndex) {
        leaveCurrentVerse(landedOn);
        return;
      }
    }

    // A reading still behind this segment's start, but not far enough to be a
    // deliberate jump -- the status simply hasn't caught up to a seek yet.
    if (status.currentTime < currentSegment.startSec - 0.5) return;

    const reachedEnd = status.currentTime >= currentSegment.endSec - 0.05;
    // End of file is the safety net for a player that stops a hair short of
    // the tagged end (see atEndOfFile). Honour it only when the playhead is
    // genuinely deep into this segment -- a finish flag left over from the
    // previous pass, arriving just after a repeat seeked back to the start, is
    // not another finish.
    const finishedShort =
      atEndOfFile &&
      status.currentTime > currentSegment.startSec + Math.min(0.25, segmentSpan / 2);
    if (!reachedEnd && !finishedShort) return;

    // Repeats-per-verse: replay THIS verse from its own start instead of
    // moving on, until it has played the requested number of times. Clearing
    // seekedToCurrentSegmentRef before the seek is what stops the next status
    // tick from firing this again and stacking up seeks while the first is
    // still in flight -- the same stale-currentTime hazard that ref exists
    // for on a backward loop.
    if (verseRepeatsDone < repeatsPerVerse - 1) {
      setVerseRepeatsDone((done) => done + 1);
      replayCurrentSegment(currentSegment.startSec, listenPlaying);
      return;
    }

    const next = findNextPlayableIndex(currentVerseIndex);
    if (next !== null) {
      leaveCurrentVerse(next);
    } else if (repeatMode === 'playlist') {
      const first = firstPlayableIndexInRange();
      setVerseRepeatsDone(0);
      if (first === currentVerseIndex) {
        // Looping a range that is only this verse -- see replayCurrentSegment.
        replayCurrentSegment(currentSegment.startSec, listenPlaying);
      } else {
        leaveCurrentVerse(first);
      }
    } else {
      markTransportCommand();
      setListenPlaying(false);
      listenPlayer.pause();
    }
  };

  // No dependency array: the listener must always hold THIS render's closure,
  // or it would advance using stale verse/repeat/selection state.
  useEffect(() => {
    onStatusTickRef.current = handleStatusTick;
  });

  const restartListen = () => {
    markTransportCommand();
    setListenPlaying(false);
    const first = firstPlayableIndexInRange();
    setVerseRepeatsDone(0);
    repeatSeekPendingRef.current = false;
    if (first === currentVerseIndex) {
      // Already on the first verse in range, so the index doesn't change and
      // nothing else will seek (see replayCurrentSegment). resume is false
      // because restartListen never pauses the underlying player -- only the
      // React flag -- so the audio is still rolling and only needs moving.
      const segment = playableSegments[first];
      if (segment?.recording) replayCurrentSegment(segment.startSec, false);
    } else {
      setCurrentVerseIndex(first);
    }
    setTimeout(() => setListenPlaying(true), 150);
  };

  const toggleListenPlaying = () => {
    markTransportCommand();
    if (listenPlaying) {
      listenPlayer.pause();
      setListenPlaying(false);
    } else {
      if (!currentSegment?.recording && hasAnyAudio) {
        // Sitting on a verse with no audio (e.g. selection starts on a gap)
        // -- jump to the nearest playable one instead of doing nothing.
        setCurrentVerseIndex(firstPlayableIndexInRange());
      }
      setListenPlaying(true);
      if (listenLoaded) listenPlayer.play();
    }
  };

  // Tapping a verse in the reading pane either jumps playback straight to it
  // (normal playlist modes), or -- in Selection mode -- marks the start/end
  // of the loop range, exactly like the old word-tap mechanic but at verse
  // granularity. Tapping the SAME verse twice is a one-verse loop: end ===
  // start is just the shortest valid range, not a special case.
  const handleVerseClick = (index: number) => {
    if (playSource !== 'selection') {
      setCurrentVerseIndex(index);
      return;
    }

    if (selectionStart === null || (selectionStart !== null && selectionEnd !== null)) {
      setSelectionStart(index);
      setSelectionEnd(null);
      setCurrentVerseIndex(index);
    } else {
      if (index < selectionStart) {
        // Tapped back above the start -- treat it as re-placing the start
        // rather than as an impossible backwards range.
        setSelectionStart(index);
        setCurrentVerseIndex(index);
      } else {
        // Includes index === selectionStart: closes a single-verse segment.
        setSelectionEnd(index);
      }
    }
  };

  // Footer wording for the current selection -- computed out here, not inline
  // in the JSX, so TypeScript keeps the narrowing on selectionStart/End.
  let segmentStatusLabel: string | null = null;

  if (playSource === 'selection' && selectionStart !== null) {
    if (selectionEnd === null) {
      segmentStatusLabel = 'Tap end verse';
    } else {
      const count = selectionEnd - selectionStart + 1;
      segmentStatusLabel = count === 1 ? 'Looping 1 verse' : `Looping ${count} verses`;
    }
  }

  return {
    playSource,
    setPlaySource,
    activePlayVerses,
    listenViewMode,
    setListenViewMode,
    selectionStart,
    setSelectionStart,
    selectionEnd,
    setSelectionEnd,
    referenceText,
    listenPlaying,
    listenSpeed,
    setListenSpeed,
    currentVerseIndex,
    setCurrentVerseIndex,
    repeatMode,
    setRepeatMode,
    repeatsPerVerse,
    setRepeatsPerVerse,
    verseRepeatsDone,
    openSetting,
    setOpenSetting,
    autoFollow,
    setAutoFollow,
    verseListRef,
    verseContentRef,
    verseCardRefs,
    playableSegments,
    hasAnyAudio,
    currentSegment,
    photoVerse,
    photosForCurrentChapter,
    sessionHasPhotos,
    listenPlayer,
    restartListen,
    toggleListenPlaying,
    handleVerseClick,
    segmentStatusLabel,
  };
}

export type ListenPlayback = ReturnType<typeof useListenPlayback>;
