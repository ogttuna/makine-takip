const DATABASE_NAME = "freezedry-browser-tail";
const STORE_NAME = "handles";
const LEGACY_DIRECTORY_HANDLE_KEY = "machine-csv-directory";
const DIRECTORY_HANDLE_PREFIX = "machine-csv-directory";
const SOURCE_ID_PREFIX = "freezedry.browserTail.sourceId";
const ENABLED_PREFIX = "freezedry.browserTail.enabled";

export async function saveDirectoryHandle(
  machineId: number,
  handle: FileSystemDirectoryHandle,
): Promise<void> {
  const database = await openDatabase();
  await requestAsPromise(
    database
      .transaction(STORE_NAME, "readwrite")
      .objectStore(STORE_NAME)
      .put(handle, directoryHandleKey(machineId)),
  );
  database.close();
}

export async function loadDirectoryHandle(
  machineId: number,
): Promise<FileSystemDirectoryHandle | null> {
  try {
    const database = await openDatabase();
    const scopedHandle = await readDirectoryHandle(database, directoryHandleKey(machineId));
    const legacyHandle =
      scopedHandle ??
      (machineId === 1
        ? await readDirectoryHandle(database, LEGACY_DIRECTORY_HANDLE_KEY)
        : undefined);
    database.close();
    return legacyHandle ?? null;
  } catch {
    return null;
  }
}

export function browserTailSourceId(machineId: number): string {
  const key = scopedKey(SOURCE_ID_PREFIX, machineId);

  try {
    const scoped = window.localStorage.getItem(key);
    if (scoped) {
      return scoped;
    }

    const legacy =
      machineId === 1 ? window.localStorage.getItem(SOURCE_ID_PREFIX) : null;
    const id = legacy || createSourceId();
    window.localStorage.setItem(key, id);
    return id;
  } catch {
    return createSourceId();
  }
}

export function createNewBrowserTailSourceId(machineId: number): string {
  const id = createSourceId();
  try {
    window.localStorage.setItem(scopedKey(SOURCE_ID_PREFIX, machineId), id);
  } catch {
    // The generated ID remains valid for the current tab.
  }
  return id;
}

export function isBrowserTailEnabled(machineId: number): boolean {
  try {
    const scoped = window.localStorage.getItem(scopedKey(ENABLED_PREFIX, machineId));
    if (scoped !== null) {
      return scoped === "true";
    }

    return machineId === 1 && window.localStorage.getItem(ENABLED_PREFIX) === "true";
  } catch {
    return false;
  }
}

export function setBrowserTailEnabled(machineId: number, enabled: boolean): void {
  try {
    window.localStorage.setItem(scopedKey(ENABLED_PREFIX, machineId), String(enabled));
  } catch {
    // Persistence is best-effort. The current tab still keeps scanning.
  }
}

function createSourceId(): string {
  if (typeof crypto.randomUUID === "function") {
    return `browser-${crypto.randomUUID()}`;
  }

  const random = Array.from(crypto.getRandomValues(new Uint8Array(16)))
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
  return `browser-${random}`;
}

function directoryHandleKey(machineId: number): string {
  return scopedKey(DIRECTORY_HANDLE_PREFIX, machineId);
}

function scopedKey(prefix: string, machineId: number): string {
  return `${prefix}.${machineId}`;
}

function readDirectoryHandle(
  database: IDBDatabase,
  key: string,
): Promise<FileSystemDirectoryHandle | undefined> {
  return requestAsPromise<FileSystemDirectoryHandle | undefined>(
    database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key),
  );
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Browser storage could not open"));
  });
}

function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error("Browser storage request failed"));
  });
}
