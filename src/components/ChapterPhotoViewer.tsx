import { useEffect, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, useWindowDimensions, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ChevronLeft, ChevronRight, Trash2, X } from 'lucide-react-native';

import { AppIconButton, AppText } from './design';
import ZoomablePhoto from './ZoomablePhoto';
import { Dropdown } from './Dropdown';
import type { PhotoCacheMap } from '../lib/photoCache';
import type { ChapterPhoto } from '../types';

/** Dropdown needs a concrete value, so "no tag" gets a sentinel rather than null. */
const UNTAGGED = 0;

/**
 * Full-screen viewer for a chapter's Bible page photos.
 *
 * Owns the pager, the page/verse chrome, and the management actions; each page
 * is a ZoomablePhoto, which owns pinch, pan, and double-tap. The one piece of
 * shared state between them is `zoomed` -- while a page is magnified the pager
 * releases the horizontal swipe, so dragging around the page does not flick to
 * the next photo.
 */
export default function ChapterPhotoViewer({
  photos,
  initialIndex,
  title,
  verseNumbers,
  photoCache,
  onClose,
  onCache,
  onDelete,
  onSetRange,
  onReorder,
}: {
  photos: ChapterPhoto[];
  initialIndex: number;
  title: string;
  verseNumbers: number[];
  photoCache: PhotoCacheMap;
  onClose: () => void;
  onCache: (photo: ChapterPhoto) => Promise<void> | void;
  onDelete: (photo: ChapterPhoto) => Promise<void> | void;
  onSetRange: (photo: ChapterPhoto, start: number | null, end: number | null) => Promise<void> | void;
  onReorder: (orderedIds: string[]) => Promise<void> | void;
}) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const scrollRef = useRef<ScrollView>(null);
  const didInitialScroll = useRef(false);
  const [index, setIndex] = useState(initialIndex);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  // While a page is zoomed the pager must let go of the horizontal swipe, or
  // panning around a magnified page would flick to the next photo instead.
  const [zoomed, setZoomed] = useState(false);

  // Clamp after a delete shortens the list out from under the current page.
  const safeIndex = Math.min(index, Math.max(0, photos.length - 1));
  const current: ChapterPhoto | undefined = photos[safeIndex];

  // Pull the full-size image onto disk as it comes into view, so the same photo
  // is there without signal when Listen reaches for it later.
  useEffect(() => {
    if (current) void onCache(current);
  }, [current?.id]);

  useEffect(() => {
    setConfirmingDelete(false);
  }, [current?.id]);

  if (!current) return null;

  const goTo = (next: number, animated = true) => {
    setIndex(next);
    scrollRef.current?.scrollTo({ x: next * width, animated });
  };

  const move = (delta: number) => {
    const target = safeIndex + delta;
    if (target < 0 || target >= photos.length) return;
    const ids = photos.map((p) => p.id);
    const [moved] = ids.splice(safeIndex, 1);
    ids.splice(target, 0, moved);
    void onReorder(ids);
    // The reordered list re-sorts under us, so the photo we were looking at is
    // now at `target` -- follow it rather than staying on a fixed slot.
    goTo(target);
  };

  const startOptions = [
    { id: UNTAGGED, label: 'Untagged' },
    ...verseNumbers.map((v) => ({ id: v, label: `Verse ${v}` })),
  ];
  const endOptions = verseNumbers
    .filter((v) => current.verseStart == null || v >= current.verseStart)
    .map((v) => ({ id: v, label: `Verse ${v}` }));

  return (
    <Modal visible transparent={false} animationType="slide" onRequestClose={onClose}>
      {/* GestureHandlerRootView INSIDE the Modal, not just at the app root:
          on Android an RN Modal renders in its own window, and gestures inside
          it are dead without a root view of their own. Harmless on iOS. */}
      <GestureHandlerRootView className="flex-1 bg-black" style={{ paddingTop: insets.top }}>
        <View className="flex-row items-center justify-between px-3 pb-2">
          <View className="flex-1">
            <AppText variant="label" className="font-serif font-bold text-white" numberOfLines={1}>
              {title}
            </AppText>
            <AppText variant="micro" className="font-sans text-white/50">
              Page {safeIndex + 1} of {photos.length}
            </AppText>
          </View>
          <AppIconButton
            Icon={X}
            diameter={36}
            iconSize={18}
            iconColor="#FFFFFF"
            onPress={onClose}
            className="rounded-full border border-white/25"
          />
        </View>

        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          // ONCE, guarded by a ref. onLayout fires on every layout pass, not
          // just the first -- without the guard, anything that re-lays the
          // scroll view (a rotation, the keyboard, a re-render) would yank the
          // user back to the page they entered on.
          onLayout={() => {
            if (didInitialScroll.current) return;
            didInitialScroll.current = true;
            scrollRef.current?.scrollTo({ x: initialIndex * width, animated: false });
          }}
          onMomentumScrollEnd={(e) =>
            setIndex(Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width)))
          }
          scrollEnabled={!zoomed}
          className="flex-1"
        >
          {photos.map((photo, i) => (
            <ZoomablePhoto
              key={photo.id}
              // Cached local file when we have it, remote otherwise -- the
              // cache is keyed on storage path because Firebase rotates
              // download tokens on the URL.
              uri={photoCache.get(photo.storagePath) ?? photo.url}
              width={width}
              imageWidth={photo.width}
              imageHeight={photo.height}
              isActive={i === safeIndex}
              onZoomChange={setZoomed}
            />
          ))}
        </ScrollView>

        {photos.length > 1 && (
          <View className="flex-row items-center justify-center gap-1.5 py-2">
            {photos.map((photo, i) => (
              <Pressable
                key={photo.id}
                onPress={() => goTo(i)}
                hitSlop={6}
                className={`rounded-full ${i === safeIndex ? 'bg-white' : 'bg-white/30'}`}
                style={{ width: 6, height: 6 }}
              />
            ))}
          </View>
        )}

        <View className="bg-neutral-900 px-3 pt-3 gap-3" style={{ paddingBottom: insets.bottom + 12 }}>
          <View className="gap-1">
            <AppText variant="micro" className="font-sans font-bold uppercase tracking-wider text-white/40">
              Which verses are on this page?
            </AppText>
            <View className="flex-row gap-2">
              <View className="flex-1">
                <Dropdown
                  value={current.verseStart ?? UNTAGGED}
                  onChange={(v) =>
                    v === UNTAGGED
                      ? void onSetRange(current, null, null)
                      : void onSetRange(current, Number(v), current.verseEnd ?? Number(v))
                  }
                  options={startOptions}
                  title="First verse on this page"
                  placeholder="From"
                />
              </View>
              <View className="flex-1">
                {current.verseStart != null ? (
                  <Dropdown
                    value={current.verseEnd ?? current.verseStart}
                    onChange={(v) => void onSetRange(current, current.verseStart!, Number(v))}
                    options={endOptions}
                    title="Last verse on this page"
                    placeholder="To"
                  />
                ) : (
                  // Untagged is a real, common answer -- the photo still shows,
                  // it just sits out Listen's auto-flip. Say so instead of
                  // leaving a dead control.
                  <View className="justify-center h-full">
                    <AppText variant="micro" className="font-sans text-white/40">
                      Optional — untagged pages still show here.
                    </AppText>
                  </View>
                )}
              </View>
            </View>
          </View>

          <View className="flex-row items-center justify-between">
            <View className="flex-row items-center gap-2">
              <AppIconButton
                Icon={ChevronLeft}
                diameter={36}
                iconSize={18}
                iconColor={safeIndex === 0 ? '#525252' : '#FFFFFF'}
                disabled={safeIndex === 0}
                onPress={() => move(-1)}
                className="rounded-lg border border-white/25"
              />
              <AppText variant="micro" className="font-sans font-bold uppercase tracking-wider text-white/40">
                Reorder
              </AppText>
              <AppIconButton
                Icon={ChevronRight}
                diameter={36}
                iconSize={18}
                iconColor={safeIndex === photos.length - 1 ? '#525252' : '#FFFFFF'}
                disabled={safeIndex === photos.length - 1}
                onPress={() => move(1)}
                className="rounded-lg border border-white/25"
              />
            </View>

            {confirmingDelete ? (
              <View className="flex-row items-center gap-2">
                <Pressable onPress={() => setConfirmingDelete(false)} hitSlop={8}>
                  <AppText variant="caption" className="font-sans font-bold text-white/60">Cancel</AppText>
                </Pressable>
                <Pressable
                  onPress={() => {
                    setConfirmingDelete(false);
                    void onDelete(current);
                  }}
                  className="bg-red-600 rounded-lg px-3 py-2"
                >
                  <AppText variant="caption" className="font-sans font-bold text-white">Delete page</AppText>
                </Pressable>
              </View>
            ) : (
              <AppIconButton
                Icon={Trash2}
                diameter={36}
                iconSize={17}
                iconColor="#F87171"
                onPress={() => setConfirmingDelete(true)}
                className="rounded-lg border border-red-500/40"
              />
            )}
          </View>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}
