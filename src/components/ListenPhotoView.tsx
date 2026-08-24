import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, View } from 'react-native';
import { Image } from 'expo-image';
import {
  Directions,
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Camera, Crosshair, Maximize2, X } from 'lucide-react-native';

import { AppIconButton, AppText } from './design';
import ZoomablePhoto from './ZoomablePhoto';
import { photoForVerse } from '../lib/chapterPhotos';
import type { PhotoCacheMap } from '../lib/photoCache';
import type { ChapterPhoto } from '../types';

/**
 * The Bible-page layer inside Listen's display panel.
 *
 * Two things make this different from the Chapter Landing viewer:
 *
 * 1. It FOLLOWS PLAYBACK. As audio advances, the page whose tagged verse range
 *    contains the current verse comes up automatically. The moment the user
 *    pages by hand that latch releases for the rest of the session -- otherwise
 *    the page yanks itself away mid-read, which is worse than not following.
 *
 * 2. It renders ONE image, not a pager. A paged ScrollView would mount all six
 *    full-size photos at once, and at roughly 24MB decoded apiece that is real
 *    pressure inside a modal that also owns an audio player. Manual paging is a
 *    fling instead. This view is a locator anyway -- reading happens full-screen.
 */
export default function ListenPhotoView({
  photos,
  chapterLabel,
  verse,
  photoCache,
  onCache,
  onAddPhoto,
  visible,
}: {
  /** Photos for the CURRENT verse's chapter, already sorted. */
  photos: ChapterPhoto[];
  /** e.g. "John 3" -- named because a session often spans several chapters. */
  chapterLabel: string;
  verse: number | null;
  photoCache: PhotoCacheMap;
  onCache: (photo: ChapterPhoto) => void;
  onAddPhoto: () => void;
  /**
   * Whether this layer is the selected Display mode. The layer stays MOUNTED
   * either way -- this only gates fetching, so a session that never opens the
   * photo view never spends the user's data on one.
   */
  visible: boolean;
}) {
  const insets = useSafeAreaInsets();
  // null == following playback. A number == the user took the wheel.
  const [manualIndex, setManualIndex] = useState<number | null>(null);
  const [expanded, setExpanded] = useState(false);
  // Latches on first reveal and stays on: the point is to defer the initial
  // fetch, not to tear the image down every time the user flips to Verse List.
  const [everVisible, setEverVisible] = useState(visible);
  const lastChapter = useRef(chapterLabel);

  useEffect(() => {
    if (visible) setEverVisible(true);
  }, [visible]);

  const autoPhoto = verse == null ? undefined : photoForVerse(photos, verse);
  const autoIndex = autoPhoto ? photos.findIndex((p) => p.id === autoPhoto.id) : -1;

  // A manual index from one chapter is meaningless in the next one, so crossing
  // a chapter boundary hands the wheel back to playback. The latch is meant to
  // protect the page you are reading, not to outlive the passage entirely.
  useEffect(() => {
    if (lastChapter.current !== chapterLabel) {
      lastChapter.current = chapterLabel;
      setManualIndex(null);
    }
  }, [chapterLabel]);

  const following = manualIndex === null;
  const resolved = following ? (autoIndex >= 0 ? autoIndex : 0) : manualIndex;
  const index = Math.min(Math.max(0, resolved), Math.max(0, photos.length - 1));
  const current: ChapterPhoto | undefined = photos[index];

  useEffect(() => {
    if (current && everVisible) onCache(current);
  }, [current?.id, everVisible]);

  const page = (delta: number) => {
    const next = index + delta;
    if (next < 0 || next >= photos.length) return;
    setManualIndex(next);
  };

  // .runOnJS(true) is REQUIRED, not a preference. Gesture callbacks default to
  // running as worklets on the UI runtime, and `page` is a plain JS function
  // that sets React state -- calling it from a worklet throws "Tried to
  // synchronously call a Remote Function". Since this handler does no
  // UI-thread animation work, running the whole thing on the JS thread is
  // simpler than wrapping the call in runOnJS.
  const flings = Gesture.Race(
    Gesture.Fling().direction(Directions.RIGHT).runOnJS(true).onEnd(() => page(-1)),
    Gesture.Fling().direction(Directions.LEFT).runOnJS(true).onEnd(() => page(1))
  );

  if (photos.length === 0) {
    return (
      <View className="flex-1 items-center justify-center px-6 gap-2">
        <Camera size={20} color="#A3A3A3" />
        <AppText variant="caption" className="font-sans text-neutral-500 text-center">
          No page photo for {chapterLabel} yet.
        </AppText>
        <Pressable
          onPress={onAddPhoto}
          className="border border-neutral-300 rounded-lg px-3 py-1.5 mt-1"
          hitSlop={6}
        >
          <AppText variant="micro" className="font-sans font-bold uppercase tracking-wider text-neutral-700">
            Add a photo
          </AppText>
        </Pressable>
      </View>
    );
  }

  if (!current) return null;

  const uri = photoCache.get(current.storagePath) ?? current.url;

  return (
    <>
      <GestureDetector gesture={flings}>
        <View className="flex-1">
          <Image
            // Undefined until first reveal -- keeps the component mounted (so
            // the view tree never changes shape) while deferring both the
            // download and the decode until the photo view is actually used.
            source={everVisible ? { uri } : undefined}
            style={{ width: '100%', height: '100%' }}
            contentFit="contain"
            transition={150}
          />

          {/* Same slot the selection-mode hint uses, so it is a proven position
              over this panel. Names the CHAPTER as well as the page: a mixed
              session means the photo on screen might belong to a different
              chapter than the one you think you are hearing. */}
          <View className="absolute top-2 right-2 bg-white/90 border border-neutral-200 rounded px-2 py-1">
            <AppText variant="micro" className="font-sans font-bold text-neutral-700">
              {chapterLabel}
              {photos.length > 1 ? ` · Page ${index + 1}` : ''}
            </AppText>
          </View>

          <Pressable
            onPress={() => setExpanded(true)}
            className="absolute bottom-2 right-2 bg-white/90 border border-neutral-200 rounded items-center justify-center"
            style={{ width: 28, height: 28 }}
            hitSlop={6}
          >
            <Maximize2 size={14} color="#1A1A1A" />
          </Pressable>

          {/* Only worth saying once the latch is actually released -- a
              "Following playback" badge in the default state would be chrome
              explaining that nothing is wrong. */}
          {!following && (
            <Pressable
              onPress={() => setManualIndex(null)}
              className="absolute bottom-2 left-2 flex-row items-center gap-1 bg-white/90 border border-neutral-200 rounded px-2 py-1"
              hitSlop={6}
            >
              <Crosshair size={11} color="#1A1A1A" />
              <AppText variant="micro" className="font-sans font-bold text-neutral-700">
                Follow again
              </AppText>
            </Pressable>
          )}

          {photos.length > 1 && (
            // box-none: this row spans the full width, so without it the empty
            // space either side of the dots would swallow taps aimed at the
            // "Follow again" chip and the expand button underneath it.
            <View
              pointerEvents="box-none"
              className="absolute bottom-2 left-0 right-0 flex-row items-center justify-center gap-1.5"
            >
              {photos.map((photo, i) => (
                <Pressable
                  key={photo.id}
                  onPress={() => setManualIndex(i)}
                  hitSlop={6}
                  className={`rounded-full ${i === index ? 'bg-neutral-800' : 'bg-neutral-800/25'}`}
                  style={{ width: 6, height: 6 }}
                />
              ))}
            </View>
          )}
        </View>
      </GestureDetector>

      {/* Read-only lightbox. Deliberately NOT the Chapter Landing viewer: delete,
          reorder, and re-tagging have no business one tap away mid-session. */}
      <Modal visible={expanded} animationType="fade" onRequestClose={() => setExpanded(false)}>
        <GestureHandlerRootView className="flex-1 bg-black" style={{ paddingTop: insets.top }}>
          <View className="flex-row items-center justify-between px-3 pb-2">
            <AppText variant="label" className="font-serif font-bold text-white">
              {chapterLabel}
              {photos.length > 1 ? ` · Page ${index + 1} of ${photos.length}` : ''}
            </AppText>
            <AppIconButton
              Icon={X}
              diameter={36}
              iconSize={18}
              iconColor="#FFFFFF"
              onPress={() => setExpanded(false)}
              className="rounded-full border border-white/25"
            />
          </View>
          <View className="flex-1" style={{ paddingBottom: insets.bottom }}>
            {/* No `width` -- it measures its own box here, rather than being
                one page of a fixed-width pager. */}
            <ZoomablePhoto uri={uri} imageWidth={current.width} imageHeight={current.height} />
          </View>
        </GestureHandlerRootView>
      </Modal>
    </>
  );
}
