import type { CoachFeedback } from "./coach/types";
import type { Transcript } from "./transcript";
import type { FaceStats } from "./face/faceAnalysis";
import type { VideoStats } from "./videoAnalysis";

/**
 * Per-take data too big for localStorage, kept in this browser's IndexedDB:
 * - details: transcript, rule-based tips, AI feedback and on-camera stats (small)
 * - media: the recorded video/audio (large; pruned to the user's "keep recordings" limit)
 * Both are keyed by the take's `at` timestamp, matching the Session in history.
 */
export interface TakeDetail {
  at: string;
  transcript?: Transcript;
  tips?: string[];
  feedback?: CoachFeedback;
  video?: VideoStats;
  face?: FaceStats;
}

export interface RecordingInfo {
  at: string;
  size: number;
}

interface MediaRecord {
  at: string;
  blob: Blob;
}

const DB_NAME = "speak-up";
const DB_VERSION = 1;
const DETAILS = "details";
const MEDIA = "media";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") return Promise.reject(new Error("IndexedDB isn't available."));
  dbPromise ??= new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DETAILS)) db.createObjectStore(DETAILS, { keyPath: "at" });
      if (!db.objectStoreNames.contains(MEDIA)) db.createObjectStore(MEDIA, { keyPath: "at" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error("Couldn't open IndexedDB."));
    };
  });
  return dbPromise;
}

/** Run `fn` in a transaction and resolve with its request's result once the transaction commits. */
async function run<T>(
  stores: string | string[],
  mode: IDBTransactionMode,
  fn: (tx: IDBTransaction) => IDBRequest<T> | void,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(stores, mode);
    const req = fn(tx);
    tx.oncomplete = () => resolve(req ? req.result : (undefined as T));
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("Transaction aborted."));
  });
}

export async function saveDetail(at: string, patch: Omit<TakeDetail, "at">): Promise<void> {
  await run(DETAILS, "readwrite", (tx) => {
    const store = tx.objectStore(DETAILS);
    const get = store.get(at);
    get.onsuccess = () => store.put({ ...(get.result as TakeDetail | undefined), ...patch, at });
  });
}

export async function getDetail(at: string): Promise<TakeDetail | null> {
  const result = await run<TakeDetail | undefined>(DETAILS, "readonly", (tx) => tx.objectStore(DETAILS).get(at));
  return result ?? null;
}

export async function saveRecording(at: string, blob: Blob): Promise<void> {
  await run(MEDIA, "readwrite", (tx) => tx.objectStore(MEDIA).put({ at, blob } satisfies MediaRecord));
}

export async function getRecording(at: string): Promise<Blob | null> {
  const record = await run<MediaRecord | undefined>(MEDIA, "readonly", (tx) => tx.objectStore(MEDIA).get(at));
  return record?.blob ?? null;
}

/** Saved recordings, newest first. */
export async function listRecordings(): Promise<RecordingInfo[]> {
  const records = await run<MediaRecord[]>(MEDIA, "readonly", (tx) => tx.objectStore(MEDIA).getAll());
  return records.map((r) => ({ at: r.at, size: r.blob.size })).sort((a, b) => b.at.localeCompare(a.at));
}

export async function deleteRecording(at: string): Promise<void> {
  await run(MEDIA, "readwrite", (tx) => tx.objectStore(MEDIA).delete(at));
}

export async function deleteTake(at: string): Promise<void> {
  await run([DETAILS, MEDIA], "readwrite", (tx) => {
    tx.objectStore(DETAILS).delete(at);
    tx.objectStore(MEDIA).delete(at);
  });
}

/** Keep only the newest `keep` recordings. Returns how many were deleted. */
export async function pruneRecordings(keep: number): Promise<number> {
  const stale = (await listRecordings()).slice(Math.max(0, keep));
  if (stale.length === 0) return 0;
  await run(MEDIA, "readwrite", (tx) => {
    const store = tx.objectStore(MEDIA);
    for (const r of stale) store.delete(r.at);
  });
  return stale.length;
}

/** Ask the browser not to evict our data under storage pressure (best effort). */
export function requestPersistentStorage(): void {
  void navigator.storage?.persist?.().catch(() => false);
}
