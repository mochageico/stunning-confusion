import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

/**
 * On-device cache for Bible page photos.
 *
 * Deliberately simpler than audioCache.ts, which it otherwise mirrors: no LRU,
 * no size cap, no pinning. Six photos per chapter at ~400KB stays trivial even
 * across a hundred chapters, and unlike recordings there is no second
 * (studio-rendered) variant and no version churn -- a photo id is minted per
 * upload and its bytes are never rewritten in place. So the cache is keyed on
 * STORAGE PATH rather than download URL, for the same reason as audio:
 * Firebase rotates download tokens, which would needlessly invalidate a file
 * that is still perfectly valid.
 *
 * What it DOES copy exactly is the download-to-.part-then-rename discipline.
 * On Android the response body streams straight into the destination, so a
 * dropped connection leaves a truncated file that is indistinguishable from a
 * complete one -- a half-decoded page photo served forever. Renaming is atomic
 * enough that a file under the real name is always a file that finished.
 *
 * Web is a no-op: browsers have a working HTTP cache already.
 */

export const PHOTO_CACHE_SUPPORTED = Platform.OS !== 'web';

const CACHE_DIR_NAME = 'photo-cache';
const MANIFEST_KEY_PREFIX = 'photoCache:manifest:v1:';
const PART_SUFFIX = '.part';

/** Storage path -> local file name. */
type PhotoCacheManifest = Record<string, string>;

/** Storage path -> local `file://` URI, for synchronous lookup during render. */
export type PhotoCacheMap = ReadonlyMap<string, string>;

let manifest: PhotoCacheManifest = {};
let activeUid: string | null = null;
const inFlight = new Set<string>();

export function emptyPhotoCacheMap(): PhotoCacheMap {
  return new Map();
}

function localFileName(storagePath: string): string {
  return storagePath.replace(/[^A-Za-z0-9._-]/g, '_');
}

function cacheDirectory(): Directory {
  // Paths.document, not Paths.cache: the OS can reclaim the cache directory
  // under storage pressure, which would silently undo the work this exists to
  // do -- and re-downloading a page photo mid-session is exactly the stall the
  // cache is here to prevent.
  const dir = new Directory(Paths.document, CACHE_DIR_NAME);
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function buildMap(): PhotoCacheMap {
  const dir = cacheDirectory();
  const map = new Map<string, string>();
  for (const [storagePath, fileName] of Object.entries(manifest)) {
    map.set(storagePath, new File(dir, fileName).uri);
  }
  return map;
}

async function persist(): Promise<void> {
  if (!activeUid) return;
  try {
    await AsyncStorage.setItem(MANIFEST_KEY_PREFIX + activeUid, JSON.stringify(manifest));
  } catch (err) {
    console.error('Failed to persist photo cache manifest:', err);
  }
}

/**
 * Reconciles the manifest against the filesystem in both directions. The
 * manifest is what we believe we have; the disk is what we really have, and
 * they drift on an interrupted write, a restore from backup, or an account
 * switch.
 */
function reconcileWithDisk(): void {
  const dir = cacheDirectory();
  const known = new Set<string>();

  for (const [storagePath, fileName] of Object.entries(manifest)) {
    const file = new File(dir, fileName);
    if (!file.exists || file.size === 0) {
      delete manifest[storagePath];
      continue;
    }
    known.add(fileName);
  }

  // Anything on disk the manifest does not name is unreachable: a leftover
  // .part, or another account's files (manifest is per-uid, the directory is
  // shared). Dropping the latter is what makes an account switch clean up
  // after itself -- the cost is a re-download on switching back, which is the
  // right trade for not leaving one user's Bible photos on disk under
  // another user's session.
  for (const child of dir.list()) {
    if (child instanceof File && !known.has(child.name)) {
      try {
        child.delete();
      } catch (err) {
        console.error('Failed to remove stray cached photo:', child.name, err);
      }
    }
  }
}

/** Call on sign-in and on every account switch. */
export async function initPhotoCache(uid: string): Promise<PhotoCacheMap> {
  if (!PHOTO_CACHE_SUPPORTED) return emptyPhotoCacheMap();

  activeUid = uid;
  try {
    const raw = await AsyncStorage.getItem(MANIFEST_KEY_PREFIX + uid);
    manifest = raw ? (JSON.parse(raw) as PhotoCacheManifest) : {};
  } catch {
    manifest = {};
  }

  try {
    reconcileWithDisk();
  } catch (err) {
    // Filesystem unusable -- stream everything rather than hand out URIs we
    // cannot stand behind.
    console.error('Photo cache unavailable:', err);
    manifest = {};
    return emptyPhotoCacheMap();
  }

  await persist();
  return buildMap();
}

/** Forgets the in-memory cache on sign-out. Files stay for the next sign-in. */
export function releasePhotoCache(): void {
  manifest = {};
  activeUid = null;
  inFlight.clear();
}

/**
 * Pulls one photo onto disk. Resolves to the new map when the file landed, or
 * null when there was nothing to do or the attempt failed -- callers keep using
 * the remote URL either way, so a failure is never user-visible.
 */
export async function cachePhoto(
  storagePath: string,
  remoteUrl: string
): Promise<PhotoCacheMap | null> {
  if (!PHOTO_CACHE_SUPPORTED || !activeUid) return null;
  if (manifest[storagePath] || inFlight.has(storagePath)) return null;
  inFlight.add(storagePath);

  const dir = cacheDirectory();
  const fileName = localFileName(storagePath);
  const part = new File(dir, `${fileName}${PART_SUFFIX}`);

  try {
    if (part.exists) part.delete();

    await File.downloadFileAsync(remoteUrl, part, { idempotent: true });
    if (!part.exists || part.size === 0) {
      throw new Error(`Download produced no bytes for ${storagePath}`);
    }

    const destination = new File(dir, fileName);
    if (destination.exists) destination.delete();
    part.rename(fileName);

    manifest[storagePath] = fileName;
    await persist();
    return buildMap();
  } catch (err) {
    console.error('Failed to cache photo:', storagePath, err);
    try {
      if (part.exists) part.delete();
    } catch {
      // reconcileWithDisk sweeps strays on next launch.
    }
    return null;
  } finally {
    inFlight.delete(storagePath);
  }
}

/**
 * Drops specific files -- a deleted photo. Resolves to the new map when
 * anything actually changed, null otherwise, so callers can skip a re-render.
 */
export async function removeCachedPhotos(
  storagePaths: (string | null | undefined)[]
): Promise<PhotoCacheMap | null> {
  if (!PHOTO_CACHE_SUPPORTED || !activeUid) return null;

  const dir = cacheDirectory();
  let changed = false;

  for (const storagePath of storagePaths) {
    if (!storagePath) continue;
    const fileName = manifest[storagePath];
    if (!fileName) continue;
    try {
      const file = new File(dir, fileName);
      if (file.exists) file.delete();
    } catch (err) {
      // Drop the manifest entry anyway: whatever referenced this file is gone,
      // so continuing to hand out a URI for it is strictly worse than losing
      // track of the bytes, and reconcileWithDisk sweeps the file next launch.
      console.error('Failed to delete cached photo:', fileName, err);
    }
    delete manifest[storagePath];
    changed = true;
  }

  if (!changed) return null;
  await persist();
  return buildMap();
}

/** Used by account deletion, where "files stay for next sign-in" is wrong. */
export async function clearPhotoCache(): Promise<PhotoCacheMap> {
  if (!PHOTO_CACHE_SUPPORTED) return emptyPhotoCacheMap();

  const uid = activeUid;
  manifest = {};
  inFlight.clear();

  try {
    // Not cacheDirectory() -- that recreates what we are removing.
    const dir = new Directory(Paths.document, CACHE_DIR_NAME);
    if (dir.exists) dir.delete();
  } catch (err) {
    console.error('Failed to clear photo cache directory:', err);
  }

  if (uid) {
    try {
      await AsyncStorage.removeItem(MANIFEST_KEY_PREFIX + uid);
    } catch (err) {
      console.error('Failed to clear photo cache manifest:', err);
    }
  }

  return buildMap();
}
