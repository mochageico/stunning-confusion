import { useRef } from 'react';
import { View } from 'react-native';

import type { StarRef } from '../types';
import { AppState } from '../state/useAppState';
import { FadeInView } from '../components/ui';
import { useScaledSpace } from '../components/design';
import ConstellationMap from '../components/map/ConstellationMap';
import { takeSkyFocus } from '../lib/skyFocus';
import { listenVerses } from '../components/map/addStars';

// ============================================================================
// MY SKY (CONSTELLATION_SKY_PLAN.md, stage 3): the user's own night sky, reached
// from the browse page's My sky card and after Add to my sky. The map itself,
// its zoom and its pop-ups live in components/map/ConstellationMap; this screen
// hands it the app state it needs.
//
// To open it zoomed into one constellation (e.g. from the review summary):
//   setSkyFocus(constellationId); navigateTo('mySky');   // lib/skyFocus.ts
// ============================================================================

export default function MySkyScreen({ state }: { state: AppState }) {
  const space = useScaledSpace();
  // Read once when the screen opens, and cleared, so coming back later opens on the whole sky.
  const focusId = useRef<string | null | undefined>(undefined);
  if (focusId.current === undefined) focusId.current = takeSkyFocus();

  // Listen plays the stars that are found, in line order: what the user holds as they hold it,
  // the rest fetched (the same rule as the preview page's Listen).
  const listen = async (refs: StarRef[]) => {
    const verses = await listenVerses(refs, state.memoryQueue, state.selectedTranslationId);
    if (verses.length === 0) {
      state.triggerToast('Nothing to listen to yet.');
      return;
    }
    state.startPractice('listen', verses, { listenSource: 'selection' });
  };

  return (
    <FadeInView style={{ flex: 1 }}>
      <View className="flex-1 bg-canvas" style={{ paddingHorizontal: space(20), paddingTop: space(20), paddingBottom: space(8) }}>
        <ConstellationMap
          queue={state.memoryQueue}
          sky={state.sky}
          skyReady={state.skyReady}
          verseLinks={state.verseLinks}
          mapLayout={state.mapLayout}
          saveMapLayout={state.saveMapLayout}
          translationId={state.selectedTranslationId}
          onOpenVerse={(page) => state.openVersePage(page)}
          addVersesToQueue={state.addVersesToQueue}
          addVerseLink={state.addVerseLink}
          relabelVerseLink={state.relabelVerseLink}
          deleteVerseLink={state.deleteVerseLink}
          walk={{
            handleUpdateVerseStatus: state.handleUpdateVerseStatus,
            validateTouch: state.validateTouch,
            isReviewDue: state.isReviewDue,
            reviewsPaused: state.reviewsPaused,
          }}
          focusId={focusId.current}
          onLeave={() => state.navigateTo('constellations')}
          onBrowse={() => state.navigateTo('constellations')}
          onRemoveFromSky={(id) => void state.removeFromSky(id)}
          onListen={(refs) => void listen(refs)}
          onFound={state.markFound}
          play={{
            userRecordings: state.userRecordings,
            selectedChapterAudios: state.selectedChapterAudios,
            studioPlaybackEnabled: state.studioPlaybackEnabled,
            audioCacheMap: state.audioCache.map,
            onStart: () => state.setPlayingRecordingId(null),
          }}
        />
      </View>
    </FadeInView>
  );
}
