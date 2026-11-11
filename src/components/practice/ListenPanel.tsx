import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { libraryReaderOf } from '../../lib/libraryAudio';
import { LibraryCredit } from '../VersePlayButton';
import { LocateFixed, Minus, Pause, Pencil, Play, Plus, RefreshCw, Repeat, Sliders, X } from 'lucide-react-native';
import { scriptOfVerse } from '../../lib/textScript';
import { ChipRow } from '../ui';
import MemoryGrid from '../MemoryGrid';
import ListenPhotoView from '../ListenPhotoView';
import { AppButton, AppIconButton, AppText, RadioMark, ToggleRow, useFontScale, type useScaledSpace } from '../design';
import { Dialog, EmptyState, GroupedList, ListRow, SegmentedControl } from '../blocks';
import { ModeChip, OptionsPopup } from '../session';
import { EMPTY_PHOTO_CACHE, LISTEN_REPEATS, LISTEN_SPEED_MAX, LISTEN_SPEED_MIN, LISTEN_SPEED_STEP, ListenProgress } from './shared';
import type { PracticeModalsProps } from '../PracticeModals';
import type { useThemeColors } from '../theme';
import { playlistSource, type ListenPlayback, type ListenSource } from './useListenPlayback';
import { PlaylistEditor } from './PlaylistEditor';
import type { ListenPlaylist } from '../../types';

/** The picker's Create playlist row: opens the editor rather than playing anything. */
const CREATE_PLAYLIST = 'create-playlist' as const;

// The practice screen's Listen layout: playlist and display pickers, the verse
// list / memory grid / page photo, segment status, and the transport and
// settings controls. All state comes from useListenPlayback via PracticeModals.
// Split out of PracticeModals.tsx (see .claude/file-split-plan.md).

interface ListenPanelProps {
  listen: ListenPlayback;
  verses: PracticeModalsProps['verses'];
  allVerses: PracticeModalsProps['allVerses'];
  memoryQueue: PracticeModalsProps['memoryQueue'];
  primingLookahead: NonNullable<PracticeModalsProps['primingLookahead']>;
  setPrimingLookahead: PracticeModalsProps['setPrimingLookahead'];
  playlists: ListenPlaylist[];
  onSavePlaylist: PracticeModalsProps['onSaveListenPlaylist'];
  onDeletePlaylist: PracticeModalsProps['onDeleteListenPlaylist'];
  preferredTranslationId: PracticeModalsProps['preferredTranslationId'];
  highlightedVerses: PracticeModalsProps['highlightedVerses'];
  onToggleVerseHighlight: PracticeModalsProps['onToggleVerseHighlight'];
  verseDoodles: PracticeModalsProps['verseDoodles'];
  onSaveVerseDoodle: PracticeModalsProps['onSaveVerseDoodle'];
  memoryGridColumns: NonNullable<PracticeModalsProps['memoryGridColumns']>;
  photoCache: PracticeModalsProps['photoCache'];
  onCacheChapterPhoto: PracticeModalsProps['onCacheChapterPhoto'];
  onAddChapterPhoto: PracticeModalsProps['onAddChapterPhoto'];
  palette: ReturnType<typeof useThemeColors>;
  space: ReturnType<typeof useScaledSpace>;
  /** The header gear's "Listen settings" pop-up. */
  optionsOpen: boolean;
  onCloseOptions: () => void;
}

export default function ListenPanel({
  listen,
  verses,
  allVerses,
  memoryQueue,
  primingLookahead,
  setPrimingLookahead,
  playlists,
  onSavePlaylist,
  onDeletePlaylist,
  preferredTranslationId,
  highlightedVerses,
  onToggleVerseHighlight,
  verseDoodles,
  onSaveVerseDoodle,
  memoryGridColumns,
  photoCache,
  onCacheChapterPhoto,
  onAddChapterPhoto,
  palette,
  space,
  optionsOpen,
  onCloseOptions,
}: ListenPanelProps) {
  const scale = useFontScale();
  const {
    playSource,
    setPlaySource,
    activePlayVerses,
    listenViewMode,
    setListenViewMode,
    selectionStart,
    setSelectionStart,
    selectionEnd,
    setSelectionEnd,
    listenPlaying,
    listenSpeed,
    setListenSpeed,
    shuffle,
    toggleShuffle,
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
  } = listen;

  const stepSpeed = (delta: number) =>
    setListenSpeed((cur) =>
      Math.min(LISTEN_SPEED_MAX, Math.max(LISTEN_SPEED_MIN, Math.round((cur + delta) * 10) / 10))
    );

  // Playlist editor: closed, a new playlist (null), or one being edited.
  const [editing, setEditing] = useState<ListenPlaylist | null | undefined>(undefined);
  const playingPlaylist = playlists.find((p) => playSource === playlistSource(p.id));
  const sourceOptions: { id: ListenSource | typeof CREATE_PLAYLIST; label: string }[] = [
    { id: 'all', label: "Today's verses" },
    { id: 'memorization', label: 'Learning now' },
    { id: 'reviewing', label: 'Review' },
    { id: 'priming', label: 'Coming up' },
    { id: 'selection', label: 'Selected verses' },
    ...playlists.map((p) => ({ id: playlistSource(p.id), label: p.name })),
  ];
  const sourceLabel = sourceOptions.find((o) => o.id === playSource)?.label ?? 'Selected verses';
  const [sourceOpen, setSourceOpen] = useState(false);

  // List or memory grid, remembered so Text goes back to whichever you chose.
  const [textMode, setTextMode] = useState<'verses' | 'memoryGrid'>(listenViewMode === 'memoryGrid' ? 'memoryGrid' : 'verses');
  const pickTextMode = (m: 'verses' | 'memoryGrid') => {
    setTextMode(m);
    if (listenViewMode !== 'photo') setListenViewMode(m);
  };

  // "28–29" for the slim loop line; chapter:verse when the range crosses chapters.
  const verseAt = (i: number | null) => (i === null ? null : activePlayVerses[i] ?? null);
  const loopStart = verseAt(selectionStart);
  const loopEnd = verseAt(selectionEnd);
  const short = (v: { chapter: number; verse: number }, other?: { chapter: number } | null) =>
    other && other.chapter !== v.chapter ? `${v.chapter}:${v.verse}` : `${v.verse}`;
  const loopLabel = !loopStart
    ? null
    : !loopEnd
      ? `From ${short(loopStart)}`
      : loopEnd === loopStart
        ? short(loopStart)
        : `${short(loopStart, loopEnd)}–${short(loopEnd, loopStart)}`;
  const clearLoop = () => {
    setSelectionStart(null);
    setSelectionEnd(null);
    setCurrentVerseIndex(0);
  };

  return (
    <View className="flex-1 justify-between">
      {/* Which verses play (a chip that opens a centered picker) and, when
          the chapter has a page photo, a Text / Page switch. List vs memory
          grid lives in the gear. */}
      <View className="flex-row flex-wrap items-center mb-2.5 shrink-0" style={{ gap: 8 }}>
        <View className="flex-row items-center" style={{ flexGrow: 1, flexShrink: 1, gap: 8 }}>
          <ModeChip
            label={sourceLabel}
            onPress={() => setSourceOpen(true)}
            accessibilityLabel={`Playing ${sourceLabel}, change`}
          />
        </View>
        {sessionHasPhotos ? (
          <View style={{ flexBasis: space(150), flexGrow: 0 }}>
            <SegmentedControl
              value={listenViewMode === 'photo' ? 'page' : 'text'}
              onChange={(id) => setListenViewMode(id === 'page' ? 'photo' : textMode)}
              accessibilityLabel="Display"
              options={[
                { id: 'text' as const, label: 'Text' },
                { id: 'page' as const, label: 'Page' },
              ]}
            />
          </View>
        ) : null}
      </View>

      {/* Verse Highlight Box — verse-by-verse, not word-by-word: the
          only real timing data this app has is per verse. */}
      <View className="bg-surface border border-line rounded-card flex-1 mb-3 overflow-hidden">
        {/* Content area. The photo layer is absolute within THIS box
            rather than the panel, so it covers the two scroll views
            without also covering the footer bar below them. */}
        <View className="flex-1">
        {listenViewMode === 'memoryGrid' ? (
          <ScrollView className="flex-1 p-3" contentContainerStyle={{ paddingBottom: 12 }}>
            <MemoryGrid
              verses={activePlayVerses.map((v) => ({ book: v.book, chapter: v.chapter, verse: v.verse, text: v.text, translationId: v.translationId }))}
              columns={memoryGridColumns}
              activeIndex={listenPlaying ? currentVerseIndex : undefined}
              highlightedKeys={highlightedVerses}
              onToggleHighlight={onToggleVerseHighlight ? (key) => onToggleVerseHighlight(key) : undefined}
              doodles={verseDoodles}
              onSaveDoodle={onSaveVerseDoodle ? (key, _v, strokes) => onSaveVerseDoodle(key, strokes) : undefined}
              onTapVerse={(_v, index) => handleVerseClick(index)}
            />
          </ScrollView>
        ) : (
        <ScrollView
          ref={verseListRef}
          className="flex-1 p-2"
          contentContainerStyle={{ paddingBottom: 12 }}
          onScrollBeginDrag={() => {
            // Only a real finger-drag lands here -- a programmatic
            // scrollTo doesn't -- and only while audio is actually
            // playing: scrolling a paused list to read ahead shouldn't
            // quietly disarm Follow.
            if (listenPlaying) setAutoFollow(false);
          }}
        >
          {/* One wrapper around every card, so measureLayout has a
              stable content-relative origin to measure against. The gap
              lives here rather than on contentContainerStyle for the
              same reason. */}
          <View ref={verseContentRef} collapsable={false} style={{ gap: 4 }}>
          {activePlayVerses.map((verseObj, index) => {
            const segment = playableSegments[index];
            const hasAudio = !!segment.recording;
            const isActive = index === currentVerseIndex && listenPlaying;
            const isRead = index < currentVerseIndex;
            // Amber = a start is placed and the segment is still open
            // (we're waiting on an end verse); green = the segment is
            // closed and is what will actually loop. Two colours, so
            // "half-selected" never looks like a finished selection.
            const segmentClosed = selectionStart !== null && selectionEnd !== null;
            const inSelectionRange =
              selectionStart !== null &&
              (selectionEnd !== null ? index >= selectionStart && index <= selectionEnd : index === selectionStart);

            // One continuous list, not a card per verse: the verse
            // playing gets a soft accent fill, and a selection range a
            // soft amber or green one. Verse text stays full ink even
            // without audio -- "No audio" says that on its own, and
            // greying the words made them hard to read.
            let cardClassName = 'rounded-btn px-3 py-2.5 ';
            if (isActive) {
              cardClassName += 'bg-accent-soft';
            } else if (selectionStart !== null) {
              // Only a closed range dims what's outside it; a lone start
              // just marks where playback begins.
              if (segmentClosed && !inSelectionRange) {
                cardClassName += 'opacity-40';
              } else if (segmentClosed) {
                cardClassName += 'bg-success-soft';
              }
            }

            const refClassName = isActive
              ? 'text-accent'
              : inSelectionRange
                ? segmentClosed
                  ? 'text-success'
                  : 'text-warning'
                : 'text-ink-3';
            const textClassName = isRead && !isActive ? 'text-ink-2' : 'text-ink';

            return (
              <Pressable
                key={`${verseObj.book}-${verseObj.chapter}-${verseObj.verse}`}
                onPress={() => handleVerseClick(index)}
                ref={(el) => {
                  verseCardRefs.current[index] = el as unknown as View | null;
                }}
                className={cardClassName}
              >
                <View className="flex-row items-center justify-between mb-0.5">
                  <AppText variant="caption" className={`font-sans font-semibold ${refClassName}`}>
                    {verseObj.book} {verseObj.chapter}:{verseObj.verse}
                  </AppText>
                  {!hasAudio && (
                    <AppText variant="caption" className="font-sans text-ink-3">
                      No audio
                    </AppText>
                  )}
                </View>
                <AppText variant="body" script={scriptOfVerse(verseObj)} className={`font-serif leading-relaxed ${textClassName}`}>{verseObj.text}</AppText>
              </Pressable>
            );
          })}
          </View>
        </ScrollView>
        )}

        {/* PHOTO LAYER -- mounted for the whole session and hidden with
            opacity, never swapped in and out alongside the other two
            views. Conditionally mounting a large decoded bitmap inside
            this live modal is the exact shape of the iOS Fabric
            shadow-tree deadlock this project has already hit once. */}
        {sessionHasPhotos && (
          <View
            className="absolute inset-0 bg-surface-2"
            style={{ opacity: listenViewMode === 'photo' ? 1 : 0 }}
            pointerEvents={listenViewMode === 'photo' ? 'auto' : 'none'}
          >
            <ListenPhotoView
              photos={photosForCurrentChapter}
              chapterLabel={photoVerse ? `${photoVerse.book} ${photoVerse.chapter}` : ''}
              verse={photoVerse?.verse ?? null}
              photoCache={photoCache ?? EMPTY_PHOTO_CACHE}
              onCache={(photo) => onCacheChapterPhoto?.(photo)}
              onAddPhoto={() =>
                photoVerse && onAddChapterPhoto?.(photoVerse.book, photoVerse.chapter)
              }
              visible={listenViewMode === 'photo'}
            />
          </View>
        )}
        {/* Follow: an icon in the corner that keeps the playing verse on
            screen. Only for the verse list, the one view that can run the
            verse off-screen. Tapping a verse to start / loop still works;
            the hint line that explained it is gone. */}
        {listenViewMode === 'verses' && (
          <View className="absolute" style={{ right: space(10), bottom: space(10) }}>
            <AppIconButton
              Icon={LocateFixed}
              diameter={40}
              iconColor={autoFollow ? palette.accent : palette.ink3}
              className={`border ${autoFollow ? 'bg-accent-soft border-accent' : 'bg-surface border-line-strong'}`}
              onPress={() => setAutoFollow((on) => !on)}
              accessibilityRole="switch"
              accessibilityState={{ checked: autoFollow }}
              accessibilityLabel="Follow the playing verse"
            />
          </View>
        )}
        </View>
      </View>

      {/* Custom Control and Audio Looping Panel */}
      <View className="gap-3 bg-surface pt-2">
        {!hasAnyAudio ? (
          <EmptyState
            title="No recordings for these verses yet"
            message="Record one on the Audio tab, or pick a narration on the chapter's page."
          />
        ) : (
          <>
            {/* Settings pills. These replaced two bordered cards, each
                holding a bordered inner pill, each holding bordered 20pt
                -/+ buttons -- three nested border tones stacked, with
                nothing reading as more important than anything else.
                Worse, those -/+ buttons were fixed at w-5 h-5: no
                useFontScale, well under MIN_TOUCH, and at 1.5x text
                scale the glyph outgrew the box around it.

                Now each setting is one pill showing its current value,
                and tapping it expands the choices directly above the row
                -- still on this screen, never behind a sheet. Only one
                expands at a time because they share the row's space, but
                nothing is hidden by that: every pill states its own
                value whether or not it's open. */}
            <View className="gap-1.5">
              {openSetting === 'repeats' && (
                <View className="bg-surface-2 border border-line rounded-card p-2.5 gap-2">
                  <AppText variant="caption" className="font-sans font-semibold text-ink-2">
                    Times each verse plays before moving on
                  </AppText>
                  <ChipRow
                    value={repeatsPerVerse}
                    onChange={(v) => { setRepeatsPerVerse(Number(v)); setOpenSetting(null); }}
                    options={LISTEN_REPEATS.map((n) => ({ id: n, label: `${n}×` }))}
                  />
                </View>
              )}

              <View className="flex-row gap-1.5">
                {/* Speed. Closed it is a small pill; tapping it opens a
                    stepper in place -- minus on the left, the value (tap
                    to close) in the middle, plus on the right. */}
                {openSetting === 'speed' ? (
                  <View className="flex-row items-center rounded-full border bg-surface-2 border-line-strong shrink-0">
                    <AppIconButton
                      variant="bare"
                      Icon={Minus}
                      diameter={28}
                      iconSize={12}
                      onPress={() => stepSpeed(-LISTEN_SPEED_STEP)}
                      disabled={listenSpeed <= LISTEN_SPEED_MIN}
                      accessibilityLabel="Slower"
                    />
                    <AppButton // button-ok: a Listen setting pill that draws its own on/off state
                      size="sm"
                      onPress={() => setOpenSetting(null)}
                      accessibilityLabel={`Playback speed ${listenSpeed.toFixed(1)}×, tap to close`}
                    >
                      <AppText variant="micro" numberOfLines={1} className="font-sans font-semibold text-ink">
                        {listenSpeed.toFixed(1)}×
                      </AppText>
                    </AppButton>
                    <AppIconButton
                      variant="bare"
                      Icon={Plus}
                      diameter={28}
                      iconSize={12}
                      onPress={() => stepSpeed(LISTEN_SPEED_STEP)}
                      disabled={listenSpeed >= LISTEN_SPEED_MAX}
                      accessibilityLabel="Faster"
                    />
                  </View>
                ) : (
                  <AppButton // button-ok: a Listen setting pill that draws its own on/off state
                    size="sm"
                    onPress={() => setOpenSetting('speed')}
                    accessibilityLabel={`Playback speed ${listenSpeed.toFixed(1)}×`}
                    className="flex-1 flex-row items-center justify-center gap-1 rounded-full border bg-surface border-line-strong"
                  >
                    <Sliders size={10} color={palette.ink3} />
                    <AppText variant="micro" numberOfLines={1} className="font-sans font-semibold text-ink">
                      {listenSpeed.toFixed(1)}×
                    </AppText>
                  </AppButton>
                )}

                <AppButton // button-ok: a Listen setting pill that draws its own on/off state
                  size="sm"
                  onPress={() => setOpenSetting((cur) => (cur === 'repeats' ? null : 'repeats'))}
                  className={`flex-1 rounded-full border ${openSetting === 'repeats' ? 'bg-surface-2 border-line-strong' : 'bg-surface border-line-strong'}`}
                >
                  <AppText variant="micro" numberOfLines={1} className="font-sans font-semibold text-ink">
                    {repeatsPerVerse}× each
                  </AppText>
                </AppButton>
                {/* Shuffle and Loop all moved to the gear (Job 3). */}
              </View>
            </View>

            {/* Progress bar — overall position across the playlist,
                smoothly advancing using the real playhead within the
                current verse's segment.

                The START and END captions that used to flank the counter
                are gone: the ends of a progress bar are already its
                start and its end, and they cost a whole line to say so.
                What's left is the one caption carrying information,
                centred under the bar. */}
            <ListenProgress
              player={listenPlayer}
              startSec={currentSegment?.startSec ?? null}
              endSec={currentSegment?.endSec ?? null}
              verseIndex={currentVerseIndex}
              verseCount={activePlayVerses.length}
              repeatsPerVerse={repeatsPerVerse}
              verseRepeatsDone={verseRepeatsDone}
            />

            {/* The looped range, one slim line under the bar: "⟲ 28–29 ✕".
                Amber while only a start is placed, green once it loops. */}
            {loopLabel ? (
              <View className="flex-row items-center justify-center" style={{ gap: space(6), marginTop: -space(6) }}>
                <Repeat size={Math.round(13 * scale)} color={selectionEnd === null ? palette.warning : palette.success} strokeWidth={2.4} />
                <AppText
                  variant="caption"
                  className={`font-sans font-semibold ${selectionEnd === null ? 'text-warning' : 'text-success'}`}
                  accessibilityLabel={segmentStatusLabel ?? undefined}
                >
                  {loopLabel}
                </AppText>
                <AppIconButton
                  variant="bare"
                  Icon={X}
                  diameter={22}
                  iconColor={palette.ink3}
                  onPress={clearLoop}
                  accessibilityLabel="Stop looping these verses"
                />
              </View>
            ) : null}

            {/* The built-in Hebrew reading's licence requires its credit wherever it plays. */}
            <LibraryCredit reader={libraryReaderOf(currentSegment?.recording)} />

            {/* Transport. Restart drops to an icon circle -- it's the
                secondary action and its label was buying a third of the
                row -- which hands that width to the one control that
                gets pressed constantly. AppIconButton scales the circle
                with the font setting and makes up any shortfall against
                MIN_TOUCH with hitSlop, so shrinking it visually doesn't
                shrink the tap target.

                The play label is "Play", not the old "Start Looping":
                that was only ever true when the repeat pill was on. */}
            <View className="flex-row items-center gap-2.5 pb-1">
              <AppIconButton
                variant="outline"
                Icon={RefreshCw}
                diameter={44}
                iconSize={18}
                onPress={restartListen}
                accessibilityLabel="Restart from the first verse"
                className="shrink-0"
              />
              <AppButton
                size="lg"
                variant="primary"
                Icon={listenPlaying ? Pause : Play}
                label={listenPlaying ? 'Pause' : 'Play'}
                onPress={toggleListenPlaying}
                className="flex-1"
              />
            </View>
          </>
        )}
      </View>
      {/* Which verses play: centered, one tap picks and closes. */}
      <Dialog visible={sourceOpen} onClose={() => setSourceOpen(false)} title="Which verses play">
        <View style={{ gap: space(12) }}>
          <GroupedList>
            {sourceOptions.map((o) => (
              <ListRow
                key={o.id}
                title={o.label}
                accessory={<RadioMark selected={o.id === playSource} />}
                onPress={() => {
                  setPlaySource(o.id as ListenSource);
                  setSourceOpen(false);
                }}
              />
            ))}
          </GroupedList>
          {playSource === 'priming' && setPrimingLookahead ? (
            <View style={{ gap: space(6) }}>
              <AppText variant="caption" className="font-sans font-semibold text-ink-2">
                Coming up · show up to
              </AppText>
              <ChipRow
                value={primingLookahead}
                onChange={(v) => setPrimingLookahead(Number(v))}
                options={[10, 20, 30, 40, 50].map((n) => ({ id: n, label: `${n}` }))}
              />
            </View>
          ) : null}
          {onSavePlaylist ? (
            <GroupedList>
              {playingPlaylist ? (
                <ListRow
                  Icon={Pencil}
                  title={`Edit ${playingPlaylist.name}`}
                  onPress={() => {
                    setSourceOpen(false);
                    setEditing(playingPlaylist);
                  }}
                />
              ) : null}
              <ListRow
                Icon={Plus}
                title="Create playlist"
                onPress={() => {
                  setSourceOpen(false);
                  setEditing(null);
                }}
              />
            </GroupedList>
          ) : null}
        </View>
      </Dialog>

      {/* The header gear: what used to sit on screen as pills. */}
      <OptionsPopup visible={optionsOpen} onClose={onCloseOptions} title="Listen settings">
        <View style={{ gap: space(16) }}>
          <ToggleRow label="Shuffle" hint="Passages in a random order" value={shuffle} onChange={() => toggleShuffle()} />
          <ToggleRow
            label="Loop all"
            hint="Start again from the top at the end"
            value={repeatMode === 'playlist'}
            onChange={(on) => setRepeatMode(on ? 'playlist' : 'off')}
          />
          <View style={{ gap: space(6) }}>
            <AppText variant="caption" className="font-sans font-semibold text-ink-2">
              Show text as
            </AppText>
            <SegmentedControl
              value={textMode}
              onChange={pickTextMode}
              accessibilityLabel="Show text as"
              options={[
                { id: 'verses' as const, label: 'List' },
                { id: 'memoryGrid' as const, label: 'Memory grid' },
              ]}
            />
          </View>
        </View>
      </OptionsPopup>

      {onSavePlaylist && (
        <PlaylistEditor
          visible={editing !== undefined}
          playlist={editing ?? null}
          memoryQueue={memoryQueue ?? []}
          preferredTranslationId={preferredTranslationId}
          onClose={() => setEditing(undefined)}
          onSave={(saved) => {
            onSavePlaylist(saved);
            setPlaySource(playlistSource(saved.id));
            setEditing(undefined);
          }}
          onDelete={
            onDeletePlaylist
              ? (id) => {
                  onDeletePlaylist(id);
                  if (playSource === playlistSource(id)) setPlaySource('selection');
                  setEditing(undefined);
                }
              : undefined
          }
        />
      )}
    </View>
  );
}
