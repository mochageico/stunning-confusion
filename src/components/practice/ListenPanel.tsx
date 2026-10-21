import { Pressable, ScrollView, View } from 'react-native';
import { MoveVertical, Pause, Play, RefreshCw, Repeat, Sliders } from 'lucide-react-native';
import { scriptOfVerse } from '../../lib/textScript';
import { ChipRow } from '../ui';
import { Dropdown } from '../Dropdown';
import MemoryGrid from '../MemoryGrid';
import ListenPhotoView from '../ListenPhotoView';
import { AppButton, AppIconButton, AppText, type useScaledSpace } from '../design';
import { EmptyState, SegmentedControl } from '../blocks';
import { EMPTY_PHOTO_CACHE, LISTEN_REPEATS, LISTEN_SPEEDS, ListenProgress } from './shared';
import type { PracticeModalsProps } from '../PracticeModals';
import type { useThemeColors } from '../theme';
import type { ListenPlayback } from './useListenPlayback';

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
}

export default function ListenPanel({
  listen,
  verses,
  allVerses,
  memoryQueue,
  primingLookahead,
  setPrimingLookahead,
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
}: ListenPanelProps) {
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

  return (
    <View className="flex-1 justify-between">
      {/* Which verses play, and how they're shown. The verse picker
          names its current choice rather than a fixed "Verse
          Selection" label, and the display is a segmented control:
          two or three short choices, all visible at once. They wrap
          onto two lines at large text sizes. */}
      <View className="flex-row flex-wrap items-center mb-2.5 shrink-0" style={{ gap: 8 }}>
        {((memoryQueue && memoryQueue.length > 0) || (allVerses && allVerses.length > 0)) && (
          <View style={{ flexGrow: 1, flexBasis: space(150) }}>
            <Dropdown
              value={playSource}
              onChange={setPlaySource}
              options={[
                { id: 'all', label: "Today's verses" },
                { id: 'memorization', label: 'Learning now' },
                { id: 'reviewing', label: 'Review' },
                { id: 'priming', label: 'Coming up next' },
                { id: 'selection', label: 'Selected verses' },
              ]}
              title="Which verses play"
              searchable={false}
            />
          </View>
        )}
        <View style={{ flexGrow: 1, flexBasis: space(150) }}>
          <SegmentedControl
            value={listenViewMode}
            onChange={setListenViewMode}
            accessibilityLabel="Display"
            options={[
              { id: 'verses' as const, label: 'List' },
              { id: 'memoryGrid' as const, label: 'Grid' },
              ...(sessionHasPhotos ? [{ id: 'photo' as const, label: 'Photo' }] : []),
            ]}
          />
        </View>
      </View>

      {/* Same control as Today's "Coming up next" section. */}
      {playSource === 'priming' && setPrimingLookahead && (
        <View className="flex-row items-center justify-end mb-2.5 shrink-0" style={{ gap: 8 }}>
          <AppText variant="caption" className="font-sans font-medium text-ink-3">
            Show
          </AppText>
          <Dropdown
            value={primingLookahead}
            onChange={(v) => setPrimingLookahead(Number(v))}
            options={[10, 20, 30, 40, 50].map((n) => ({ id: n, label: `${n}` }))}
            title="How many to show"
            compact
          />
        </View>
      )}

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
            const segmentClosed = playSource === 'selection' && selectionStart !== null && selectionEnd !== null;
            const inSelectionRange =
              playSource === 'selection' &&
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
            } else if (playSource === 'selection' && selectionStart !== null) {
              if (!inSelectionRange) {
                cardClassName += 'opacity-40';
              } else {
                cardClassName += segmentClosed ? 'bg-success-soft' : 'bg-warning-soft';
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
        </View>

        {/* Segment status and the Follow toggle. The old floating "Tap
            verse to set start" corner chip is gone -- it said the same
            thing this bar already says -- and so is the animated wave
            indicator that used to sit on the right: it was decoration
            competing with real controls, and the play button already
            says whether audio is running. A hairline instead of a
            filled grey bar, so this reads as the bottom edge of the
            verse list rather than a fourth stacked band of chrome. */}
        <View className="border-t border-line px-3 py-2 flex-row justify-between items-center gap-2 z-10">
          <View className="flex-row items-center gap-2 flex-1">
            {playSource === 'selection' && selectionStart !== null ? (
              <>
                <AppButton
                  size="sm"
                  variant="quiet"
                  Icon={RefreshCw}
                  label="Reset"
                  onPress={() => { setSelectionStart(null); setSelectionEnd(null); setCurrentVerseIndex(0); }}
                  className="shrink-0"
                />
                {/* Matches the row colours: amber while the segment is
                    still open, green once it is closed and looping. */}
                <AppText
                  variant="caption"
                  className={`font-sans font-semibold flex-1 ${selectionEnd === null ? 'text-warning' : 'text-success'}`}
                >
                  {segmentStatusLabel}
                </AppText>
              </>
            ) : (
              <AppText variant="caption" className="font-sans text-ink-3 flex-1">
                {playSource === 'selection' ? 'Tap the first verse to loop' : 'Tap a verse to play from there'}
              </AppText>
            )}
          </View>

          {/* Follow -- scrolls the list to keep the playing verse on
              screen. Only offered for the card list, the one view that
              can actually run the verse off-screen. */}
          {listenViewMode === 'verses' && (
            <AppButton // button-ok: a Listen setting pill that draws its own on/off state
              size="sm"
              onPress={() => setAutoFollow((on) => !on)}
              accessibilityRole="switch"
              accessibilityState={{ checked: autoFollow }}
              Icon={MoveVertical}
              iconColor={autoFollow ? palette.accent : palette.ink3}
              label="Follow"
              textClassName={`font-semibold ${autoFollow ? 'text-accent' : 'text-ink-2'}`}
              className={`rounded-full border shrink-0 ${autoFollow ? 'bg-accent-soft border-accent' : 'bg-surface border-line-strong'}`}
            />
          )}
        </View>
      </View>

      {/* Custom Control and Audio Looping Panel */}
      <View className="gap-3 bg-surface pt-2">
        {!hasAnyAudio ? (
          <EmptyState
            title="No recordings for these verses yet"
            message="Record one on the Record tab, or pick a narration on the chapter's page."
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
              {openSetting !== null && (
                <View className="bg-surface-2 border border-line rounded-card p-2.5 gap-2">
                  <AppText variant="caption" className="font-sans font-semibold text-ink-2">
                    {openSetting === 'speed' ? 'Playback speed' : 'Times each verse plays before moving on'}
                  </AppText>
                  {openSetting === 'speed' ? (
                    <ChipRow
                      value={listenSpeed}
                      onChange={(v) => { setListenSpeed(Number(v)); setOpenSetting(null); }}
                      options={LISTEN_SPEEDS.map((s) => ({ id: s, label: `${s.toFixed(1)}×` }))}
                    />
                  ) : (
                    <ChipRow
                      value={repeatsPerVerse}
                      onChange={(v) => { setRepeatsPerVerse(Number(v)); setOpenSetting(null); }}
                      options={LISTEN_REPEATS.map((n) => ({ id: n, label: `${n}×` }))}
                    />
                  )}
                </View>
              )}

              <View className="flex-row gap-1.5">
                <AppButton // button-ok: a Listen setting pill that draws its own on/off state
                  size="sm"
                  onPress={() => setOpenSetting((cur) => (cur === 'speed' ? null : 'speed'))}
                  className={`flex-row items-center justify-center gap-1 flex-1 rounded-full border ${openSetting === 'speed' ? 'bg-surface-2 border-line-strong' : 'bg-surface border-line-strong'}`}
                >
                  {/* An icon rather than the word "speed": spelled out,
                      this pill clipped to "1.0x s..." at 1.5x font
                      scale. The expander names it in full once open. */}
                  <Sliders size={10} color={palette.ink3} />
                  <AppText variant="micro" numberOfLines={1} className="font-sans font-semibold text-ink">
                    {listenSpeed.toFixed(1)}×
                  </AppText>
                </AppButton>

                <AppButton // button-ok: a Listen setting pill that draws its own on/off state
                  size="sm"
                  onPress={() => setOpenSetting((cur) => (cur === 'repeats' ? null : 'repeats'))}
                  className={`flex-1 rounded-full border ${openSetting === 'repeats' ? 'bg-surface-2 border-line-strong' : 'bg-surface border-line-strong'}`}
                >
                  <AppText variant="micro" numberOfLines={1} className="font-sans font-semibold text-ink">
                    {repeatsPerVerse}× each
                  </AppText>
                </AppButton>

                {/* End-of-list behaviour -- a plain toggle, so it needs no
                    expander of its own. */}
                <AppButton // button-ok: a Listen setting pill that draws its own on/off state
                  size="sm"
                  onPress={() => setRepeatMode((m) => (m === 'playlist' ? 'off' : 'playlist'))}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: repeatMode === 'playlist' }}
                  className={`flex-row items-center gap-1 rounded-full border shrink-0 ${repeatMode === 'playlist' ? 'bg-accent-soft border-accent' : 'bg-surface border-line-strong'}`}
                >
                  <Repeat size={10} color={repeatMode === 'playlist' ? palette.accent : palette.ink3} />
                  <AppText variant="micro" numberOfLines={1} className={`font-sans font-semibold ${repeatMode === 'playlist' ? 'text-accent' : 'text-ink-2'}`}>
                    {repeatMode === 'playlist' ? 'Loop' : 'Off'}
                  </AppText>
                </AppButton>
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
    </View>
  );
}
