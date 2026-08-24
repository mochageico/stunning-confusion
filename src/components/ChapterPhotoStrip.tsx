import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, View } from 'react-native';
import { Image } from 'expo-image';
import { Camera, Images, X } from 'lucide-react-native';

import { AppButton, AppText } from './design';
import ChapterPhotoViewer from './ChapterPhotoViewer';
import { MAX_PHOTOS_PER_CHAPTER, type PhotoSource } from '../lib/chapterPhotos';
import type { AppState } from '../state/useAppState';

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
          className="flex-row items-center justify-center gap-1.5 py-1"
          hitSlop={8}
        >
          {busy ? (
            <ActivityIndicator size="small" color="#888888" />
          ) : (
            <Camera size={12} color="#888888" />
          )}
          <AppText variant="micro" className="font-sans font-bold uppercase tracking-wider text-[#888]">
            {busy ? 'Adding photo…' : 'Add a photo of your Bible page'}
          </AppText>
        </Pressable>
      ) : (
        <View className="gap-1.5">
          <View className="flex-row items-center justify-between">
            <AppText variant="micro" className="font-sans font-bold uppercase tracking-wider text-[#888]">
              Bible pages
            </AppText>
            {!atCapacity && (
              <Pressable onPress={() => setChoosingSource(true)} disabled={busy} hitSlop={8}>
                <AppText variant="micro" className="font-sans font-bold uppercase tracking-wider text-[#1A1A1A]">
                  {busy ? 'Adding…' : '+ Add'}
                </AppText>
              </Pressable>
            )}
          </View>

          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
            {photos.map((photo, index) => {
              const label = rangeLabel(photo.verseStart, photo.verseEnd);
              return (
                <Pressable
                  key={photo.id}
                  onPress={() => setViewerIndex(index)}
                  className="rounded-lg overflow-hidden border border-[#E5E5E5] bg-[#F3F2F1]"
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
                      <AppText variant="micro" className="font-mono font-bold text-white text-center">
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
      <Modal visible={choosingSource} transparent animationType="fade" onRequestClose={() => setChoosingSource(false)}>
        {/* Backdrop is a sibling Pressable filling the space ABOVE the sheet,
            not a parent -- RN's Pressable has no reliable stopPropagation, so
            a tap-through guard has to be structural. Same shape as the manual
            log sheet in PracticeModals. */}
        <View className="flex-1 bg-black/40 justify-end">
          <Pressable className="flex-1" onPress={() => setChoosingSource(false)} />
          <View className="bg-white rounded-t-3xl p-5 gap-3">
            <View className="items-center gap-1 mb-1">
              <AppText variant="title" className="font-serif font-bold text-neutral-900">
                Add a Bible page
              </AppText>
              <AppText variant="caption" className="font-sans text-neutral-500 text-center px-2">
                {book} {chapter} — you can crop the photo to just the page on the next step.
              </AppText>
            </View>

            <AppButton size="md" onPress={() => add('camera')} className="w-full bg-[#1A1A1A] rounded-xl items-center flex-row justify-center gap-2">
              <Camera size={16} color="#FFFFFF" />
              <AppText variant="label" className="font-sans font-bold text-white">Take a photo</AppText>
            </AppButton>

            <AppButton size="md" onPress={() => add('library')} className="w-full border border-neutral-300 rounded-xl items-center flex-row justify-center gap-2">
              <Images size={16} color="#1A1A1A" />
              <AppText variant="label" className="font-sans font-bold text-neutral-800">Choose from library</AppText>
            </AppButton>

            <Pressable onPress={() => setChoosingSource(false)} className="w-full py-1.5 items-center flex-row justify-center gap-1">
              <X size={12} color="#A3A3A3" />
              <AppText variant="caption" className="font-sans font-bold text-neutral-400">Cancel</AppText>
            </Pressable>
          </View>
        </View>
      </Modal>

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
