import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';

import type { ChapterPhoto } from '../types';

/**
 * Capturing and preparing photos of a user's physical Bible pages.
 *
 * The whole quality argument of this feature lives in the numbers below. A
 * page of scripture is dense small type: photographed raw it is an 8-12MB file
 * that makes Chapter Landing slow and cell data expensive, and shrunk too far
 * it becomes a grey rectangle nobody opens twice. 2000px on the long edge is
 * the middle — enough to pinch into 8pt type and actually read it, while
 * landing around 400KB.
 */

/** Enough for a chapter spanning a page turn or two; low enough to bound cost. */
export const MAX_PHOTOS_PER_CHAPTER = 6;

const FULL_LONG_EDGE = 2000;
const FULL_QUALITY = 0.75;
/** Only ever shown in the Chapter Landing strip, so it can be tiny. */
const THUMB_LONG_EDGE = 400;
const THUMB_QUALITY = 0.6;

export type PhotoSource = 'camera' | 'library';

/** The same key ChapterLandingScreen builds — do not invent a second format. */
export function chapterPhotoKey(book: string, chapter: number): string {
  return `${book}_${chapter}`;
}

export function chapterPhotoPaths(uid: string, photoId: string) {
  return {
    storagePath: `chapterPhotos/${uid}/${photoId}.jpg`,
    thumbPath: `chapterPhotos/${uid}/${photoId}_thumb.jpg`,
  };
}

export function sortChapterPhotos(photos: ChapterPhoto[]): ChapterPhoto[] {
  return [...photos].sort((a, b) => a.order - b.order);
}

/**
 * Which page to show for a given verse, or undefined when nothing claims it.
 *
 * Untagged photos (no verseStart) are deliberately NOT candidates: they mean
 * "this is the chapter" rather than "this is verse 12", and auto-flipping to
 * one mid-playback would assert a precision the user never gave us.
 */
export function photoForVerse(photos: ChapterPhoto[], verse: number): ChapterPhoto | undefined {
  return sortChapterPhotos(photos).find((photo) => {
    if (photo.verseStart == null) return false;
    return verse >= photo.verseStart && verse <= (photo.verseEnd ?? photo.verseStart);
  });
}

export interface PreparedPhoto {
  /** Local file URI of the downscaled full image, ready to upload. */
  uri: string;
  thumbUri: string;
  /** Dimensions of the full image AFTER downscaling. */
  width: number;
  height: number;
}

export type PickPhotoResult =
  | { status: 'ready'; photo: PreparedPhoto }
  | { status: 'cancelled' }
  | { status: 'denied'; source: PhotoSource };

/**
 * Re-encodes to JPEG at a bounded long edge. Constrains whichever edge is
 * actually longer and lets the other follow, so a landscape two-page spread and
 * a portrait single page both come out bounded without either being stretched.
 */
async function renderVariant(
  uri: string,
  sourceWidth: number,
  sourceHeight: number,
  longEdge: number,
  compress: number
): Promise<{ uri: string; width: number; height: number }> {
  const context = ImageManipulator.manipulate(uri);
  if (Math.max(sourceWidth, sourceHeight) > longEdge) {
    if (sourceWidth >= sourceHeight) context.resize({ width: longEdge });
    else context.resize({ height: longEdge });
  }
  const rendered = await context.renderAsync();
  const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress });
  return { uri: saved.uri, width: saved.width, height: saved.height };
}

/**
 * The picker reports width/height of the chosen asset, but documents both as
 * possibly 0 when the system declines to supply them. Falling back to a render
 * costs one decode and is the only way to pick the right edge to constrain.
 */
async function resolveSourceSize(
  asset: ImagePicker.ImagePickerAsset
): Promise<{ width: number; height: number }> {
  if (asset.width > 0 && asset.height > 0) {
    return { width: asset.width, height: asset.height };
  }
  const probe = await ImageManipulator.manipulate(asset.uri).renderAsync();
  return { width: probe.width, height: probe.height };
}

/**
 * Camera or library -> cropped -> EXIF-normalized -> downscaled JPEG pair.
 *
 * Permission is requested at the moment of use rather than on screen load, so
 * a user who never touches this feature is never asked for their camera.
 */
export async function pickChapterPhoto(source: PhotoSource): Promise<PickPhotoResult> {
  const permission =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return { status: 'denied', source };

  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ['images'],
    // The OS crop step. Without it most saved photos are a whole desk with a
    // Bible somewhere on it — glare, page curl, and a thumb included.
    allowsEditing: true,
    // Full quality out of the picker on purpose: we re-encode below, and
    // letting the picker compress first would stack two lossy passes.
    quality: 1,
    exif: false,
  };

  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);

  if (result.canceled || !result.assets?.length) return { status: 'cancelled' };

  const asset = result.assets[0];
  const { width, height } = await resolveSourceSize(asset);

  const full = await renderVariant(asset.uri, width, height, FULL_LONG_EDGE, FULL_QUALITY);
  const thumb = await renderVariant(asset.uri, width, height, THUMB_LONG_EDGE, THUMB_QUALITY);

  return {
    status: 'ready',
    photo: { uri: full.uri, thumbUri: thumb.uri, width: full.width, height: full.height },
  };
}
