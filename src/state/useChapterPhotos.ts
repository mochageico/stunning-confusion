import { useEffect, useState } from 'react';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDocs,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytesResumable } from 'firebase/storage';

import { auth, db, storage, handleFirestoreError, OperationType } from '../firebase';
import type { ChapterPhoto } from '../types';
import type { PhotoCacheMap } from '../lib/photoCache';
import {
  cachePhoto,
  clearPhotoCache,
  emptyPhotoCacheMap,
  initPhotoCache,
  releasePhotoCache,
  removeCachedPhotos,
} from '../lib/photoCache';
import {
  chapterPhotoKey,
  chapterPhotoPaths,
  MAX_PHOTOS_PER_CHAPTER,
  pickChapterPhoto,
  sortChapterPhotos,
  type PhotoSource,
} from '../lib/chapterPhotos';
import { stripUndefined } from '../lib/appData';

// ============================================================================
// BIBLE PAGE PHOTOS
// ----------------------------------------------------------------------------
// Photos of the user's own physical Bible, attached to a chapter and used as
// a visual anchor. Private to the owner with no sharing path anywhere -- see
// the chapterPhotos blocks in firestore.rules / storage.rules for why.
// Split out of useAppState (see .claude/file-split-plan.md).
// ============================================================================

interface ChapterPhotosDeps {
  user: { uid: string } | null;
  triggerToast: (message: string) => void;
}

export function useChapterPhotos({ user, triggerToast }: ChapterPhotosDeps) {
  const [chapterPhotos, setChapterPhotos] = useState<ChapterPhoto[]>([]);
  const [photoCache, setPhotoCache] = useState<PhotoCacheMap>(emptyPhotoCacheMap);

  useEffect(() => {
    const uid = user?.uid;
    if (!uid) {
      releasePhotoCache();
      setPhotoCache(emptyPhotoCacheMap());
      setChapterPhotos([]);
      return;
    }
    let cancelled = false;
    initPhotoCache(uid)
      .then((map) => {
        if (!cancelled) setPhotoCache(map);
      })
      .catch((err) => console.error('Failed to load photo cache:', err));
    return () => {
      cancelled = true;
    };
  }, [user?.uid]);

  /** Loads the user's photos; called from loadUserData. */
  const loadChapterPhotos = async (uid: string) => {
    try {
      const photosSnap = await getDocs(query(collection(db, 'users', uid, 'chapterPhotos'), orderBy('order', 'asc')));
      setChapterPhotos(photosSnap.docs.map((docSnap) => docSnap.data() as ChapterPhoto));
    } catch (e) {
      handleFirestoreError(e, OperationType.GET, `users/${uid}/chapterPhotos`);
    }
  };

  /** Deletes every photo file on this device; called when the account is deleted. */
  const wipeLocalPhotos = async () => {
    setPhotoCache(await clearPhotoCache());
  };

  const photosForChapter = (book: string, chapter: number): ChapterPhoto[] =>
    sortChapterPhotos(chapterPhotos.filter((photo) => photo.chapterKey === chapterPhotoKey(book, chapter)));

  /** Pulls a photo onto disk so it survives going offline mid-session. */
  const cacheChapterPhoto = async (photo: ChapterPhoto) => {
    const next = await cachePhoto(photo.storagePath, photo.url);
    if (next) setPhotoCache(next);
  };

  const uploadPhotoFile = async (path: string, localUri: string): Promise<string> => {
    const fileRef = storageRef(storage, path);
    // Same wire-protocol constraint as recordings: uploads MUST go through
    // uploadBytesResumable and through the patched `storage` instance from
    // firebase.ts, or @firebase/storage takes its one-shot multipart path and
    // RN's Blob constructor rejects the ArrayBuffer body. See the
    // _shouldDoResumable patch there for the full story.
    const response = await fetch(localUri);
    const arrayBuffer = await response.arrayBuffer();
    await uploadBytesResumable(fileRef, arrayBuffer, { contentType: 'image/jpeg' });
    return getDownloadURL(fileRef);
  };

  const addChapterPhoto = async (book: string, chapter: number, source: PhotoSource): Promise<boolean> => {
    const uid = auth.currentUser?.uid;
    if (!uid) return false;

    const existing = photosForChapter(book, chapter);
    if (existing.length >= MAX_PHOTOS_PER_CHAPTER) {
      triggerToast(`Up to ${MAX_PHOTOS_PER_CHAPTER} photos per chapter.`);
      return false;
    }

    let prepared;
    try {
      const picked = await pickChapterPhoto(source);
      if (picked.status === 'cancelled') return false;
      if (picked.status === 'denied') {
        triggerToast(
          source === 'camera'
            ? 'Camera access is turned off for Scripture Memory.'
            : 'Photo access is turned off for Scripture Memory.'
        );
        return false;
      }
      prepared = picked.photo;
    } catch (err) {
      console.error('Failed to prepare chapter photo:', err);
      triggerToast('Could not read that photo.');
      return false;
    }

    const id = `photo_${Date.now()}`;
    const { storagePath, thumbPath } = chapterPhotoPaths(uid, id);

    try {
      // BLOBS FIRST, THEN THE DOC -- the opposite order to persistRecording,
      // and for the opposite reason. Recordings write the doc first because
      // uploading is what fires the processStudioAudio trigger, so there is a
      // race to lose. Nothing watches this prefix, so the only real failure
      // mode here is a gallery row pointing at bytes that never arrived. One
      // doc write at the end publishes a photo that is already fully there.
      const url = await uploadPhotoFile(storagePath, prepared.uri);
      const thumbUrl = await uploadPhotoFile(thumbPath, prepared.thumbUri);

      const photo: ChapterPhoto = {
        id,
        chapterKey: chapterPhotoKey(book, chapter),
        order: existing.length ? Math.max(...existing.map((p) => p.order)) + 1 : 0,
        storagePath,
        thumbPath,
        url,
        thumbUrl,
        width: prepared.width,
        height: prepared.height,
      };

      await setDoc(doc(db, 'users', uid, 'chapterPhotos', id), stripUndefined({ ...photo, createdAt: serverTimestamp() }));
      setChapterPhotos((prev) => [...prev, photo]);
      void cacheChapterPhoto(photo);
      return true;
    } catch (err) {
      // Roll the blobs back. Without this a failed add leaves Storage objects
      // that no document references, so nothing will ever delete them and they
      // bill forever.
      await Promise.all([
        deleteObject(storageRef(storage, storagePath)).catch(() => {}),
        deleteObject(storageRef(storage, thumbPath)).catch(() => {}),
      ]);
      handleFirestoreError(err, OperationType.CREATE, `users/${uid}/chapterPhotos/${id}`);
      return false;
    }
  };

  const deleteChapterPhoto = async (photo: ChapterPhoto) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    try {
      await deleteDoc(doc(db, 'users', uid, 'chapterPhotos', photo.id));
      // Two blobs per photo -- deleting only the full image silently leaks the
      // thumbnail on every delete.
      await Promise.all([
        deleteObject(storageRef(storage, photo.storagePath)).catch((err) =>
          console.error('Failed to delete photo file:', err)
        ),
        deleteObject(storageRef(storage, photo.thumbPath)).catch((err) =>
          console.error('Failed to delete photo thumbnail:', err)
        ),
      ]);
      // Third copy: on-device. Without this the local file outlives the photo
      // entirely, invisible in the app and never reclaimed.
      const nextCache = await removeCachedPhotos([photo.storagePath, photo.thumbPath]);
      if (nextCache) setPhotoCache(nextCache);
      setChapterPhotos((prev) => prev.filter((p) => p.id !== photo.id));
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, `users/${uid}/chapterPhotos/${photo.id}`);
    }
  };

  /** Pass null for verseStart to clear the tag and return the photo to untagged. */
  const setChapterPhotoVerseRange = async (photo: ChapterPhoto, verseStart: number | null, verseEnd: number | null) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const start = verseStart ?? undefined;
    // A start with no end is a single verse; a reversed pair is a slip rather
    // than an empty range, so it gets straightened instead of stored.
    const end = start == null ? undefined : Math.max(start, verseEnd ?? start);
    try {
      await updateDoc(doc(db, 'users', uid, 'chapterPhotos', photo.id), {
        verseStart: start ?? deleteField(),
        verseEnd: end ?? deleteField(),
      });
      setChapterPhotos((prev) => prev.map((p) => (p.id === photo.id ? { ...p, verseStart: start, verseEnd: end } : p)));
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${uid}/chapterPhotos/${photo.id}`);
    }
  };

  const reorderChapterPhotos = async (orderedIds: string[]) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    // Optimistic: reordering is a drag gesture, and waiting on a round trip
    // before the tiles settle reads as the drag having failed.
    setChapterPhotos((prev) =>
      prev.map((p) => {
        const index = orderedIds.indexOf(p.id);
        return index === -1 ? p : { ...p, order: index };
      })
    );
    try {
      const batch = writeBatch(db);
      orderedIds.forEach((photoId, index) => {
        batch.update(doc(db, 'users', uid, 'chapterPhotos', photoId), { order: index });
      });
      await batch.commit();
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, `users/${uid}/chapterPhotos`);
    }
  };

  return {
    chapterPhotos,
    photoCache,
    loadChapterPhotos,
    wipeLocalPhotos,
    photosForChapter,
    cacheChapterPhoto,
    addChapterPhoto,
    deleteChapterPhoto,
    setChapterPhotoVerseRange,
    reorderChapterPhotos,
  };
}
