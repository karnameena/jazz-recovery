export type RecoveryLocationStatus = "live" | "cached" | "old" | "unavailable";

export type CachedLocation = {
  latitude: number;
  longitude: number;
  accuracyMeters: number | null;
  timestamp: number;
  verifiedAt: number;
  status: RecoveryLocationStatus;
};

export type CachedPhoto = {
  blob: Blob;
  camera: string;
  timestamp: number;
  verifiedAt: number;
  mimeType: string;
};

type RecoveryRecord<T> = T & { key: string; ownerId: string; deviceId: string };

const DB_NAME = "jazz-recovery-owner-cache";
const DB_VERSION = 1;
const STORE = "recovery";


// Local Storage contains metadata only. Photo bytes and full location records stay in IndexedDB.
const META_PREFIX = "jazz-recovery-meta:v1:";
type RecoveryMetadata = {
  kind: "photo" | "location";
  ownerId: string;
  deviceId: string;
  timestamp: number;
  verifiedAt: number;
  status: string;
  camera?: string;
  mimeType?: string;
  sizeBytes?: number;
};
function metadataKey(ownerId: string, deviceId: string, kind: "photo" | "location") {
  return `${META_PREFIX}${encodeURIComponent(ownerId)}:${encodeURIComponent(deviceId)}:${kind}`;
}
function saveMetadata(metadata: RecoveryMetadata) {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(metadataKey(metadata.ownerId, metadata.deviceId, metadata.kind), JSON.stringify(metadata));
  } catch {
    // IndexedDB remains the source of truth if browser metadata storage is unavailable or full.
  }
}

function openDatabase(): Promise<IDBDatabase> {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("IndexedDB is not available in this browser."));
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "key" });
        store.createIndex("ownerDevice", ["ownerId", "deviceId"], { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Could not open recovery cache."));
    request.onblocked = () => reject(new Error("Recovery cache upgrade is blocked by another tab."));
  });
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed."));
  });
}

async function read<T>(key: string): Promise<T | null> {
  const db = await openDatabase();
  try {
    const tx = db.transaction(STORE, "readonly");
    const result = await requestResult(tx.objectStore(STORE).get(key));
    return (result as T | undefined) ?? null;
  } finally {
    db.close();
  }
}

async function writeIfNewer<T extends { timestamp: number }>(
  record: RecoveryRecord<T>,
): Promise<boolean> {
  const db = await openDatabase();
  try {
    return await new Promise<boolean>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const getRequest = store.get(record.key);
      let saved = false;
      getRequest.onsuccess = () => {
        const previous = getRequest.result as { timestamp?: number } | undefined;
        if (!previous || Number(previous.timestamp || 0) <= record.timestamp) {
          store.put(record);
          saved = true;
        }
      };
      getRequest.onerror = () => reject(getRequest.error);
      tx.oncomplete = () => resolve(saved);
      tx.onerror = () => reject(tx.error || new Error("Could not save recovery data."));
      tx.onabort = () => reject(tx.error || new Error("Recovery cache transaction aborted."));
    });
  } finally {
    db.close();
  }
}

function keyFor(ownerId: string, deviceId: string, kind: "photo" | "location") {
  if (!ownerId.trim() || !deviceId.trim()) throw new Error("Owner and device identifiers are required.");
  return `${ownerId}:${deviceId}:${kind}`;
}

export async function saveVerifiedLocation(
  ownerId: string,
  deviceId: string,
  location: Omit<CachedLocation, "status"> & { status?: RecoveryLocationStatus },
): Promise<boolean> {
  const lat = Number(location.latitude);
  const lon = Number(location.longitude);
  const timestamp = Number(location.timestamp);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 ||
      !Number.isFinite(lon) || lon < -180 || lon > 180 ||
      !Number.isFinite(timestamp) || timestamp <= 0 || timestamp > Date.now() + 5 * 60 * 1000) {
    throw new Error("Location data failed validation.");
  }
  const record: RecoveryRecord<CachedLocation> = {
    key: keyFor(ownerId, deviceId, "location"),
    ownerId, deviceId, latitude: lat, longitude: lon,
    accuracyMeters: location.accuracyMeters == null ? null : Number(location.accuracyMeters),
    timestamp, verifiedAt: Number(location.verifiedAt) || Date.now(),
    status: location.status || "live",
  };
  if (record.accuracyMeters != null &&
      (!Number.isFinite(record.accuracyMeters) || record.accuracyMeters < 0 || record.accuracyMeters > 10000)) {
    throw new Error("Location accuracy failed validation.");
  }
  const saved = await writeIfNewer(record);
  if (saved) saveMetadata({ kind: "location", ownerId, deviceId, timestamp, verifiedAt: record.verifiedAt, status: record.status });
  return saved;
}

export async function getCachedLocation(
  ownerId: string,
  deviceId: string,
): Promise<CachedLocation | null> {
  const record = await read<RecoveryRecord<CachedLocation>>(keyFor(ownerId, deviceId, "location"));
  if (!record) return null;
  // A value read from IndexedDB is never labelled live, even if it was live when received.
  const ageMs = Date.now() - Number(record.timestamp || 0);
  const status = record.status === "old" || ageMs > 24 * 60 * 60 * 1000 ? "old" : "cached";
  saveMetadata({ kind: "location", ownerId, deviceId, timestamp: record.timestamp, verifiedAt: record.verifiedAt, status });
  return { ...record, status };
}

export async function saveVerifiedPhoto(
  ownerId: string,
  deviceId: string,
  photo: CachedPhoto,
): Promise<boolean> {
  if (!(photo.blob instanceof Blob) || !photo.blob.type.startsWith("image/") ||
      photo.blob.size <= 0 || photo.blob.size > 8 * 1024 * 1024) {
    throw new Error("Photo must be a valid image no larger than 8 MB.");
  }
  const timestamp = Number(photo.timestamp);
  if (!Number.isFinite(timestamp) || timestamp <= 0) throw new Error("Photo timestamp is invalid.");
  const record: RecoveryRecord<CachedPhoto> = {
    key: keyFor(ownerId, deviceId, "photo"),
    ownerId, deviceId, ...photo, timestamp,
    verifiedAt: Number(photo.verifiedAt) || Date.now(),
    mimeType: photo.blob.type,
  };
  const saved = await writeIfNewer(record);
  if (saved) saveMetadata({ kind: "photo", ownerId, deviceId, timestamp, verifiedAt: record.verifiedAt, status: "verified", camera: record.camera, mimeType: record.mimeType, sizeBytes: record.blob.size });
  return saved;
}

export async function getCachedPhoto(
  ownerId: string,
  deviceId: string,
): Promise<CachedPhoto | null> {
  const record = await read<RecoveryRecord<CachedPhoto>>(keyFor(ownerId, deviceId, "photo"));
  if (record) saveMetadata({ kind: "photo", ownerId, deviceId, timestamp: record.timestamp, verifiedAt: record.verifiedAt, status: "verified", camera: record.camera, mimeType: record.mimeType, sizeBytes: record.blob.size });
  return record;
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/]+=*)$/.exec(dataUrl);
  if (!match) throw new Error("Recovery photo data URL is invalid.");
  const binary = atob(match[2]);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: match[1] });
}


export function getRecoveryMetadata(ownerId: string, deviceId: string, kind: "photo" | "location"): RecoveryMetadata | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const value = localStorage.getItem(metadataKey(ownerId, deviceId, kind));
    if (!value) return null;
    const parsed = JSON.parse(value) as RecoveryMetadata;
    if (parsed.ownerId !== ownerId || parsed.deviceId !== deviceId || parsed.kind !== kind || !Number.isFinite(parsed.timestamp)) return null;
    return parsed;
  } catch {
    return null;
  }
}
