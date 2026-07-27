import AsyncStorage from '@react-native-async-storage/async-storage';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import type { Recording } from '../types';
import { hasStudioAudio } from './studioAudio';

/**
 * On-device cache for recitation audio.
 *
 * Every listen currently re-downloads the whole file from Firebase Storage.
 * The Cloud Function marks studio renders `immutable` with a one-year
 * max-age, but neither AVPlayer (iOS) nor ExoPlayer (Android) keeps a general
 * HTTP disk cache for media, so that header buys nothing on device — and
 * drills replay the same recitation over and over. Caching to disk ourselves
 * is the only thing that actually makes the second listen free.
 *
 * Safe to cache aggressively because the blobs are immutable: a recording id
 * is minted per upload and its audio is never rewritten in place. The cache
 * is therefore keyed on the STORAGE PATH rather than the download URL —
 * Firebase download tokens can be rotated (and the studio render gets a fresh
 * one on every render), which would needlessly invalidate a still-valid file.
 *
 * Web is a deliberate no-op: browsers honour the immutable cache-control
 * header the Cloud Function already sets, so there is nothing to add.
 */

/** Web has a working HTTP cache already — everything here short-circuits. */
export const AUDIO_CACHE_SUPPORTED = Platform.OS !== 'web';

/** ~5 hours at the 128kbps the studio render encodes at. */
export const DEFAULT_CACHE_CAP_BYTES = 300 * 1024 * 1024;

/** Offered in Settings. */
export const CACHE_CAP_CHOICES = [100, 300, 1024].map((mb) => mb * 1024 * 1024);

const CACHE_DIR_NAME = 'audio-cache';
const MANIFEST_KEY_PREFIX = 'audioCache:manifest:v1:';
const CAP_KEY = 'audioCache:capBytes:v1';
const PART_SUFFIX = '.part';

export interface CacheEntry {
  fileName: string;
  bytes: number;
  lastPlayedAt: number;
  /** Reserved for the explicit "download for offline" control — always false
   * for auto-cached files, and the only thing eviction refuses to touch. */
  pinned: boolean;
}

/** Keyed by Storage path (`recordings/{uid}/{id}_studio.m4a`). */
export type CacheManifest = Record<string, CacheEntry>;

/**
 * Storage path -> local `file://` URI, for synchronous lookup during render.
 * Deliberately a plain ReadonlyMap rather than a type imported from here:
 * resolvePlaybackUrl consumes it, and this module imports from that one.
 */
export type AudioCacheMap = ReadonlyMap<string, string>;

export interface CacheTarget {
  storagePath: string;
  remoteUrl: string;
}

/**
 * Everything the UI needs about the cache, as one value. Bundled rather than
 * exposed as separate maps/counters so React can never render a half-updated
 * view — one state variable, one identity, always internally consistent.
 */
export interface AudioCacheSnapshot {
  /** Storage path -> local `file://` URI. */
  map: AudioCacheMap;
  /** Storage paths the user explicitly saved for offline use. */
  pinned: ReadonlySet<string>;
  totalBytes: number;
  capBytes: number;
}

export function emptyAudioCacheSnapshot(): AudioCacheSnapshot {
  return { map: new Map(), pinned: new Set(), totalBytes: 0, capBytes: DEFAULT_CACHE_CAP_BYTES };
}

// Module-level rather than React state on purpose: several downloads can be
// in flight at once, and each one finishing needs to update shared bookkeeping.
// Routing that through a state setter invites lost updates from stale
// closures. React holds only the derived map, which is rebuilt on every change.
let manifest: CacheManifest = {};
let activeUid: string | null = null;
let capBytes = DEFAULT_CACHE_CAP_BYTES;
const inFlight = new Set<string>();

/**
 * Which version of a recording is worth caching, if any.
 *
 * `studioEnabled` must be the PERSISTED Studio Mode preference, not the
 * transient A/B override from the recording detail screen — flipping that
 * switch to compare two takes shouldn't pull a second copy onto disk.
 */
export function cacheableTarget(
  recording:
    | Pick<Recording, 'audioUrl' | 'audioPath' | 'studioAudioUrl' | 'studioAudioPath' | 'studioStatus'>
    | null
    | undefined,
  studioEnabled: boolean
): CacheTarget | null {
  if (!AUDIO_CACHE_SUPPORTED || !recording) return null;

  // 'pending' means a studio render is still coming. The raw take is what
  // plays right now, but it stops being the playback target the moment that
  // render lands — caching it would spend a download and a slice of the cap
  // on a file about to be superseded. Wait for a terminal status.
  if (recording.studioStatus === 'pending') return null;

  if (studioEnabled && hasStudioAudio(recording) && recording.studioAudioPath) {
    return { storagePath: recording.studioAudioPath, remoteUrl: recording.studioAudioUrl! };
  }
  if (recording.audioUrl && recording.audioPath) {
    return { storagePath: recording.audioPath, remoteUrl: recording.audioUrl };
  }
  return null;
}

function localFileName(storagePath: string): string {
  return storagePath.replace(/[^A-Za-z0-9._-]/g, '_');
}

function cacheDirectory(): Directory {
  const dir = new Directory(Paths.document, CACHE_DIR_NAME);
  // Paths.document, not Paths.cache: the OS can reclaim the cache directory
  // under storage pressure, which would silently undo exactly the work this
  // module exists to do. Staying in document means we own eviction.
  if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
  return dir;
}

function buildSnapshot(): AudioCacheSnapshot {
  const dir = cacheDirectory();
  const map = new Map<string, string>();
  const pinned = new Set<string>();
  let totalBytes = 0;
  for (const [storagePath, entry] of Object.entries(manifest)) {
    map.set(storagePath, new File(dir, entry.fileName).uri);
    if (entry.pinned) pinned.add(storagePath);
    totalBytes += entry.bytes;
  }
  return { map, pinned, totalBytes, capBytes };
}

async function persist(): Promise<void> {
  if (!activeUid) return;
  try {
    await AsyncStorage.setItem(MANIFEST_KEY_PREFIX + activeUid, JSON.stringify(manifest));
  } catch (err) {
    console.error('Failed to persist audio cache manifest:', err);
  }
}

/**
 * Reconciles the manifest against what is actually on disk, in both
 * directions. The manifest is the source of truth for what we believe we
 * have; the filesystem is the source of truth for what we really have, and
 * they drift (an interrupted write, a restore from backup, a delete that
 * raced a manifest save).
 */
function reconcileWithDisk(): void {
  const dir = cacheDirectory();
  const known = new Set<string>();

  for (const [storagePath, entry] of Object.entries(manifest)) {
    const file = new File(dir, entry.fileName);
    if (!file.exists || file.size === 0) {
      delete manifest[storagePath];
      continue;
    }
    // Trust the filesystem over a remembered size, so the cap is enforced
    // against real bytes.
    entry.bytes = file.size;
    known.add(entry.fileName);
  }

  // Anything on disk this manifest doesn't name is unreachable: a leftover
  // .part from an interrupted download, or another account's files (the
  // manifest is namespaced per uid, the directory is shared). Dropping the
  // latter is what makes an account switch clean up after itself; the cost is
  // that switching back re-downloads, which is the right trade for not
  // leaving one user's recitations on disk under another user's session.
  for (const child of dir.list()) {
    if (child instanceof File && !known.has(child.name)) {
      try {
        child.delete();
      } catch (err) {
        console.error('Failed to remove stray cached audio file:', child.name, err);
      }
    }
  }
}

/**
 * Loads this user's cache. Call on sign-in and on every account switch;
 * returns the snapshot to drive playback resolution and the Settings readout.
 */
export async function initAudioCache(uid: string): Promise<AudioCacheSnapshot> {
  if (!AUDIO_CACHE_SUPPORTED) return emptyAudioCacheSnapshot();

  activeUid = uid;
  try {
    const raw = await AsyncStorage.getItem(MANIFEST_KEY_PREFIX + uid);
    manifest = raw ? (JSON.parse(raw) as CacheManifest) : {};
  } catch {
    // Corrupt or unreadable — reconcile below will rebuild from disk state.
    manifest = {};
  }

  // Device-local, and deliberately NOT namespaced per uid: it describes how
  // much of this phone's storage the app may use, which is a property of the
  // phone rather than of whoever is signed in.
  try {
    const rawCap = await AsyncStorage.getItem(CAP_KEY);
    const parsed = rawCap ? Number.parseInt(rawCap, 10) : NaN;
    capBytes = Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_CACHE_CAP_BYTES;
  } catch {
    capBytes = DEFAULT_CACHE_CAP_BYTES;
  }

  try {
    reconcileWithDisk();
    // The cap may have been lowered on a previous run while a different
    // account was signed in — enforce it against what actually survived.
    evictToCap();
  } catch (err) {
    // Filesystem unusable. Fall back to streaming everything rather than
    // handing out URIs we can't stand behind.
    console.error('Audio cache unavailable:', err);
    manifest = {};
    return emptyAudioCacheSnapshot();
  }

  await persist();
  return buildSnapshot();
}

/** Forgets the in-memory cache on sign-out. Files stay for the next sign-in. */
export function releaseAudioCache(): void {
  manifest = {};
  activeUid = null;
  inFlight.clear();
}

/**
 * Evicts least-recently-played unpinned files until the cache fits the cap.
 * Never throws — a file that refuses to delete keeps its manifest entry so
 * its bytes stay accounted for rather than being double-counted later.
 */
function evictToCap(): void {
  let total = Object.values(manifest).reduce((sum, entry) => sum + entry.bytes, 0);
  if (total <= capBytes) return;

  const dir = cacheDirectory();
  const candidates = Object.entries(manifest)
    .filter(([, entry]) => !entry.pinned)
    .sort((a, b) => a[1].lastPlayedAt - b[1].lastPlayedAt);

  for (const [storagePath, entry] of candidates) {
    if (total <= capBytes) break;
    try {
      const file = new File(dir, entry.fileName);
      if (file.exists) file.delete();
    } catch (err) {
      console.error('Failed to evict cached audio file:', entry.fileName, err);
      continue;
    }
    delete manifest[storagePath];
    total -= entry.bytes;
  }
}

/**
 * Downloads one recording into the cache. Resolves to the new snapshot when
 * the file landed, or null when there was nothing to do or the attempt failed
 * — callers keep streaming either way, so a failure is never user-visible.
 *
 * `pin` marks the result as explicitly saved for offline use, which exempts it
 * from eviction. An already-cached file is pinned in place rather than
 * re-downloaded.
 */
export async function cacheAudioFile(
  target: CacheTarget,
  { pin = false }: { pin?: boolean } = {}
): Promise<AudioCacheSnapshot | null> {
  if (!AUDIO_CACHE_SUPPORTED || !activeUid) return null;

  const { storagePath, remoteUrl } = target;
  const existing = manifest[storagePath];
  if (existing) {
    if (!pin || existing.pinned) return null;
    existing.pinned = true;
    await persist();
    return buildSnapshot();
  }
  if (inFlight.has(storagePath)) return null;
  inFlight.add(storagePath);

  const dir = cacheDirectory();
  const fileName = localFileName(storagePath);
  const part = new File(dir, `${fileName}${PART_SUFFIX}`);

  try {
    if (part.exists) part.delete();

    // DOWNLOAD TO .part, THEN RENAME — not straight to the final name. On
    // Android the response body streams directly into the destination, so a
    // connection that drops mid-download leaves a truncated file behind (iOS
    // stages in a temp location and is unaffected). A truncated .m4a is
    // indistinguishable from a complete one at the filesystem level, so we
    // would serve it forever as a recitation that just stops partway —
    // materially worse than not caching at all. Renaming is atomic enough
    // that a file under the real name is always a file that finished.
    await File.downloadFileAsync(remoteUrl, part, { idempotent: true });
    if (!part.exists || part.size === 0) {
      throw new Error(`Download produced no bytes for ${storagePath}`);
    }

    const bytes = part.size;
    const destination = new File(dir, fileName);
    if (destination.exists) destination.delete();
    part.rename(fileName);

    // Nothing below throws (evictToCap and persist swallow their own errors),
    // so the catch's cleanup can't reach the file now that it's in place.
    manifest[storagePath] = { fileName, bytes, lastPlayedAt: Date.now(), pinned: pin };
    evictToCap();
    await persist();
    return buildSnapshot();
  } catch (err) {
    console.error('Failed to cache audio file:', storagePath, err);
    try {
      if (part.exists) part.delete();
    } catch {
      // Nothing more to do — reconcileWithDisk sweeps strays on next launch.
    }
    return null;
  } finally {
    inFlight.delete(storagePath);
  }
}

/**
 * Drops specific files from the cache — a deleted recording, or a version
 * that stopped being the playback target. Resolves to the new snapshot when
 * anything actually changed, null otherwise, so callers can skip a re-render.
 */
export async function removeCachedAudio(
  storagePaths: (string | null | undefined)[]
): Promise<AudioCacheSnapshot | null> {
  if (!AUDIO_CACHE_SUPPORTED || !activeUid) return null;

  const dir = cacheDirectory();
  let changed = false;

  for (const storagePath of storagePaths) {
    if (!storagePath) continue;
    const entry = manifest[storagePath];
    if (!entry) continue;
    try {
      const file = new File(dir, entry.fileName);
      if (file.exists) file.delete();
    } catch (err) {
      // Drop the manifest entry anyway. Whatever referenced this file is
      // gone, so continuing to hand out a URI for it is strictly worse than
      // losing track of the bytes — and an entry-less file on disk is exactly
      // what reconcileWithDisk sweeps on next launch.
      console.error('Failed to delete cached audio file:', entry.fileName, err);
    }
    delete manifest[storagePath];
    changed = true;
  }

  if (!changed) return null;
  await persist();
  return buildSnapshot();
}

/**
 * Removes every cached file and this user's manifest. Used both by the
 * Settings "clear downloads" action and by account deletion, where "the files
 * stay for the next sign-in" (releaseAudioCache) is the wrong answer — there
 * is no next sign-in.
 */
export async function clearAudioCache(): Promise<AudioCacheSnapshot> {
  if (!AUDIO_CACHE_SUPPORTED) return emptyAudioCacheSnapshot();

  const uid = activeUid;
  manifest = {};
  inFlight.clear();

  try {
    // Not cacheDirectory() — that recreates what we're trying to remove.
    const dir = new Directory(Paths.document, CACHE_DIR_NAME);
    if (dir.exists) dir.delete();
  } catch (err) {
    console.error('Failed to clear audio cache directory:', err);
  }

  if (uid) {
    try {
      await AsyncStorage.removeItem(MANIFEST_KEY_PREFIX + uid);
    } catch (err) {
      console.error('Failed to clear audio cache manifest:', err);
    }
  }

  return buildSnapshot();
}

/**
 * Changes how much storage the cache may use, evicting immediately if the new
 * cap is smaller. Pinned downloads survive regardless — if they alone exceed
 * the cap, the cache simply sits over it rather than deleting something the
 * user explicitly asked to keep offline.
 */
export async function setCacheCapBytes(bytes: number): Promise<AudioCacheSnapshot> {
  if (!AUDIO_CACHE_SUPPORTED) return emptyAudioCacheSnapshot();

  capBytes = bytes > 0 ? bytes : DEFAULT_CACHE_CAP_BYTES;
  try {
    await AsyncStorage.setItem(CAP_KEY, String(capBytes));
  } catch (err) {
    console.error('Failed to persist audio cache cap:', err);
  }

  try {
    evictToCap();
  } catch (err) {
    console.error('Failed to evict after cap change:', err);
  }
  await persist();
  return buildSnapshot();
}

/** Bumps LRU recency. No-op for anything not cached. */
export function noteAudioPlayed(storagePath: string): void {
  const entry = manifest[storagePath];
  if (!entry) return;
  entry.lastPlayedAt = Date.now();
  void persist();
}
