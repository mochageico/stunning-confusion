import { Platform } from 'react-native';
import { initializeApp } from 'firebase/app';
// @ts-ignore — getReactNativePersistence works at runtime on the RN build of
// @firebase/auth but is missing from firebase/auth's published TS types (a known,
// long-standing gap: firebase/firebase-js-sdk#7615, #9316).
import { getAuth, initializeAuth, getReactNativePersistence } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
// @ts-ignore — `_UploadTask` is a real but underscore-prefixed (private,
// not-covered-by-semver) export; see the patch below for why it's needed.
import { _UploadTask } from 'firebase/storage';
import AsyncStorage from '@react-native-async-storage/async-storage';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);

// `getReactNativePersistence` only exists on the React Native build of
// firebase/auth — Metro resolves web bundles to the browser build instead,
// which doesn't export it (calling it there throws "is not a function").
// This app targets native (iOS/Android via Expo), so the RN branch is the
// one that matters; the web branch just keeps `expo start --web` usable too.
export const auth =
  Platform.OS === 'web'
    ? getAuth(app)
    : initializeAuth(app, {
        persistence: getReactNativePersistence(AsyncStorage),
      });

// experimentalAutoDetectLongPolling avoids stalled Firestore streams on some
// mobile networks/emulators where native WebSocket/HTTP2 streaming misbehaves.
export const db = initializeFirestore(
  app,
  { experimentalAutoDetectLongPolling: true },
  firebaseConfig.firestoreDatabaseId
);

export const storage = getStorage(app);

// Firebase Storage's uploadBytesResumable() silently falls back to a
// one-shot multipart upload for any blob <= 256KB (confirmed by reading
// node_modules/@firebase/storage/dist/index.cjs.js directly: UploadTask's
// constructor sets `this._resumable = this._shouldDoResumable(this._blob)`,
// and `_shouldDoResumable` is just `blob.size() > 256 * 1024` -- this check
// runs regardless of calling uploadBytes() vs uploadBytesResumable()). That
// one-shot path (`_oneShotUpload` -> `multipartUpload` -> `FbsBlob.getBlob`)
// builds its request body via `new Blob([metadataString, ourBytes,
// boundaryString])`, and RN's Blob constructor (0.74+) rejects any
// ArrayBuffer/ArrayBufferView part -- "Creating blobs from 'ArrayBuffer' and
// 'ArrayBufferView' are not supported". The resumable/chunked path (used for
// anything over 256KB) never hits this -- it only ever slices/sends raw
// Uint8Array chunks, no Blob construction at all.
//
// This means the "switch to uploadBytesResumable" fix in persistRecording
// (useAppState.ts) only actually worked for recordings/imports long enough
// to clear 256KB -- a single short verse recording is very plausibly under
// that, and crashes on save exactly the same way uploadBytes() always did.
// Forcing every upload through the resumable path sidesteps the crash
// regardless of file size, using the SDK's own already-working chunked
// upload code rather than reimplementing the Storage REST API by hand.
//
// `_UploadTask` is a real export but underscore-prefixed (private, not
// covered by semver) -- guarded so a future @firebase/storage version that
// renames/removes `_shouldDoResumable` fails loudly here instead of
// silently reintroducing this crash.
if (Platform.OS !== 'web') {
  const uploadTaskProto = (_UploadTask as unknown as { prototype?: Record<string, unknown> })?.prototype;
  if (uploadTaskProto && typeof uploadTaskProto._shouldDoResumable === 'function') {
    uploadTaskProto._shouldDoResumable = () => true;
  } else {
    console.error(
      'firebase.ts: @firebase/storage UploadTask.prototype._shouldDoResumable not found as expected -- ' +
        'the small-file upload crash workaround did not apply (check for an @firebase/storage version change).'
    );
  }
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

// Logs a structured error report. Deliberately does NOT throw: every caller
// invokes this from inside a catch block as an error sink, and re-throwing
// turned one failed step into an unhandled rejection (in UI handlers) or
// aborted every later, independent load step (in loadUserData).
export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
}
