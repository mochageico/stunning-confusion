import { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { Image } from 'expo-image';
import { Camera, Images } from 'lucide-react-native';

import { AppButton, AppText, useFontScale, useScaledSpace } from './design';
import { Dialog, SectionHeader } from './blocks';
import ChapterPhotoViewer from './ChapterPhotoViewer';
import { MAX_PHOTOS_PER_CHAPTER, type PhotoSource } from '../lib/chapterPhotos';
import type { AppState } from '../state/useAppState';

import { useThemeColors } from './theme';
const THUMB_WIDTH = 62;
const THUMB_HEIGHT = 84;

/**
 * Bible page photos on Chapter Landing.
 *
 * When a chapter has no photos this is ONE muted line, not a card with an
 * empty state. There are 1,189 chapters and the overwhelming majority will
 * never have a photo; a bordered "Photos (0)" panel on every one of them would
 * undo the deflation work the surrounding screen has been through.
 */
export default function ChapterPhotoStrip({
  state,
  book,
  chapter,
}: {
  state: AppState;
  book: string;
  chapter: number;
}) {
  const palette = useThemeColors();
  const scale = useFontScale();
  const space = useScaledSpace();
  const { photosForChapter, addChapterPhoto, photoCache } = state;
  const photos = photosForChapter(book, chapter);
  const verseNumbers = state.activeChapterVerses.map((v) => v.verse);

  const [choosingSource, setChoosingSource] = useState(false);
  const [busy, setBusy] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);

  const atCapacity = photos.length >= MAX_PHOTOS_PER_CHAPTER;

  const add = async (source: PhotoSource) => {
    setChoosingSource(false);
    setBusy(true);
    try {
      await addChapterPhoto(book, chapter, source);
    } finally {
      setBusy(false);
    }
  };

  const rangeLabel = (start?: number, end?: number) => {
    if (start == null) return null;
    return end == null || end === start ? `v${start}` : `v${start}-${end}`;
  };

  return (
    <>
      {photos.length === 0 ? (
        <Pressable
          onPress={() => setChoosingSource(true)}
          disabled={busy}
          accessibilityRole="button"
          className="flex-row items-center justify-center self-center active:opacity-60"
          style={{ gap: space(6), paddingVertical: space(4) }}
          hitSlop={8}
        >
          {busy ? (
            <ActivityIndicator size="small" color={palette.ink3} />
          ) : (
            <Camera size={Math.round(15 * scale)} color={palette.accent} />
          )}
          <AppText variant="label" className="font-sans font-medium text-accent">
            {busy ? 'Adding photo…' : 'Add a photo of your Bible page'}
          </AppText>
        </Pressable>
      ) : (
        <View style={{ gap: space(6) }}>
          <SectionHeader
            title="Bible pages"
            actionLabel={atCapacity ? undefined : busy ? 'Adding…' : 'Add'}
            onAction={busy ? undefined : () => setChoosingSource(true)}
          />

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {photos.map((photo, index) => {
              const label = rangeLabel(photo.verseStart, photo.verseEnd);
              return (
                <Pressable
                  key={photo.id}
                  onPress={() => setViewerIndex(index)}
                  accessibilityRole="imagebutton"
                  accessibilityLabel={label ? `Bible page, ${label}` : 'Bible page'}
                  className="rounded-btn overflow-hidden border border-line bg-surface-2"
                  style={{ width: THUMB_WIDTH, height: THUMB_HEIGHT }}
                >
                  <Image
                    source={{ uri: photo.thumbUrl }}
                    style={{ width: '100%', height: '100%' }}
                    contentFit="cover"
                    transition={120}
                  />
                  {/* Untagged pages carry no badge at all rather than an
                      "untagged" chip -- the absence is the information, and a
                      chip on every thumbnail would be noise on the common case. */}
                  {label && (
                    <View className="absolute bottom-0 left-0 right-0 bg-black/55 px-1 py-0.5">
                      <AppText variant="micro" className="font-sans font-semibold text-on-accent text-center">
                        {label}
                      </AppText>
                    </View>
                  )}
                </Pressable>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Source chooser. Camera first: the primary act is photographing the
          Bible sitting in front of you, not hunting through a camera roll. */}
      <Dialog
        visible={choosingSource}
        onClose={() => setChoosingSource(false)}
        placement="sheet"
        title="Add a Bible page"
        message={`${book} ${chapter}. You can crop the photo to just the page on the next step.`}
      >
        <View style={{ gap: space(8) }}>
          <AppButton variant="primary" Icon={Camera} label="Take a photo" onPress={() => add('camera')} />
          <AppButton variant="secondary" Icon={Images} label="Choose from library" onPress={() => add('library')} />
        </View>
      </Dialog>

      {viewerIndex !== null && photos.length > 0 && (
        <ChapterPhotoViewer
          photos={photos}
          initialIndex={Math.min(viewerIndex, photos.length - 1)}
          title={`${book} ${chapter}`}
          verseNumbers={verseNumbers}
          photoCache={photoCache}
          onClose={() => setViewerIndex(null)}
          onCache={state.cacheChapterPhoto}
          onDelete={state.deleteChapterPhoto}
          onSetRange={state.setChapterPhotoVerseRange}
          onReorder={state.reorderChapterPhotos}
        />
      )}
    </>
  );
}
