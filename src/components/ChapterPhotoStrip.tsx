import { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, View } from 'react-native';
import { BookOpen, Camera, Images } from 'lucide-react-native';

import { AppButton, AppText, useFontScale, useScaledSpace } from './design';
import { Dialog } from './blocks';
import ChapterPhotoViewer from './ChapterPhotoViewer';
import { MAX_PHOTOS_PER_CHAPTER, type PhotoSource } from '../lib/chapterPhotos';

import { useThemeColors } from './theme';
import { useAppFields } from '../state/appStore';

/**
 * Bible page photos on Chapter Landing: the right end of the recording card.
 *
 * No thumbnails. With photos it's a book icon and how many there are, which
 * opens them full screen (add more from there). With none it's one short
 * "Add page" link. Most chapters will never have a photo, so this never grows
 * past one line beside the recording.
 */
export default function ChapterPhotoStrip({
  book,
  chapter,
}: {
  book: string;
  chapter: number;
}) {
  const state = useAppFields(
    'activeChapterVerses', 'addChapterPhoto', 'cacheChapterPhoto', 'deleteChapterPhoto',
    'photoCache', 'photosForChapter', 'reorderChapterPhotos', 'setChapterPhotoVerseRange',
  );
  const palette = useThemeColors();
  const scale = useFontScale();
  const space = useScaledSpace();
  const { photosForChapter, addChapterPhoto, photoCache } = state;
  const photos = photosForChapter(book, chapter);
  const verseNumbers = state.activeChapterVerses.map((v) => v.verse);

  const [choosingSource, setChoosingSource] = useState(false);
  const [busy, setBusy] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  // Which photo the viewer opens on. After adding one it opens on the new
  // photo, so its verses can be set right away instead of landing back on
  // the chapter page.
  const [viewerIndex, setViewerIndex] = useState(0);

  const atCapacity = photos.length >= MAX_PHOTOS_PER_CHAPTER;
  const icon = Math.round(16 * scale);

  const cameFromViewer = useRef(false);
  const add = async (source: PhotoSource) => {
    setChoosingSource(false);
    setBusy(true);
    try {
      const added = await addChapterPhoto(book, chapter, source);
      if (added) {
        setViewerIndex(photos.length); // the new one is last
        setViewerOpen(true);
      } else if (photos.length > 0 && cameFromViewer.current) {
        setViewerOpen(true);
      }
    } finally {
      cameFromViewer.current = false;
      setBusy(false);
    }
  };

  const hasPhotos = photos.length > 0;

  return (
    <>
      <Pressable
        onPress={() => {
          if (!hasPhotos) return setChoosingSource(true);
          setViewerIndex(0);
          setViewerOpen(true);
        }}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={
          hasPhotos ? `Bible pages, ${photos.length} ${photos.length === 1 ? 'photo' : 'photos'}` : 'Add a photo of your Bible page'
        }
        className="flex-row items-center active:opacity-60"
        style={{ gap: space(5), paddingVertical: space(4) }}
        hitSlop={8}
      >
        {busy ? (
          <ActivityIndicator size="small" color={palette.ink3} />
        ) : hasPhotos ? (
          <BookOpen size={icon} color={palette.ink2} />
        ) : (
          <Camera size={icon} color={palette.accent} />
        )}
        <AppText
          variant="caption"
          className={`font-sans font-semibold ${hasPhotos ? 'text-ink-2' : 'text-accent'}`}
          style={hasPhotos ? { fontVariant: ['tabular-nums'] } : undefined}
        >
          {hasPhotos ? photos.length : 'Add page'}
        </AppText>
      </Pressable>

      {/* Source chooser. Camera first: the primary act is photographing the
          Bible sitting in front of you, not hunting through a camera roll. */}
      <Dialog
        visible={choosingSource}
        onClose={() => {
          setChoosingSource(false);
          if (cameFromViewer.current && hasPhotos) setViewerOpen(true);
          cameFromViewer.current = false;
        }}
        placement="sheet"
        title="Add a Bible page"
        message={`${book} ${chapter}. You can crop the photo to just the page on the next step.`}
      >
        <View style={{ gap: space(8) }}>
          <AppButton variant="primary" Icon={Camera} label="Take a photo" onPress={() => add('camera')} />
          <AppButton variant="secondary" Icon={Images} label="Choose from library" onPress={() => add('library')} />
        </View>
      </Dialog>

      {viewerOpen && hasPhotos && (
        <ChapterPhotoViewer
          photos={photos}
          initialIndex={Math.min(viewerIndex, photos.length - 1)}
          title={`${book} ${chapter}`}
          verseNumbers={verseNumbers}
          photoCache={photoCache}
          onClose={() => setViewerOpen(false)}
          onCache={state.cacheChapterPhoto}
          onDelete={state.deleteChapterPhoto}
          onSetRange={state.setChapterPhotoVerseRange}
          onReorder={state.reorderChapterPhotos}
          // The viewer is a full-screen modal; close it first so the source
          // chooser isn't stacked under it.
          onAdd={
            atCapacity
              ? undefined
              : () => {
                  cameFromViewer.current = true;
                  setViewerOpen(false);
                  setChoosingSource(true);
                }
          }
        />
      )}
    </>
  );
}
