const DATABASE_NAME = "freezedry-browser-tail";
const STORE_NAME = "handles";
const DIRECTORY_HANDLE_KEY = "machine-csv-directory";
const SOURCE_ID_KEY = "freezedry.browserTail.sourceId";
const ENABLED_KEY = "freezedry.browserTail.enabled";

export async function saveDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const database = await openDatabase();
  await requestAsPromise(
    database.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME).put(handle, DIRECTORY_HANDLE_KEY),
  );
  database.close();
}

export async function loadDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const database = await openDatabase();
    const handle = await requestAsPromise<FileSystemDirectoryHandle | undefined>(
      database.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(DIRECTORY_HANDLE_KEY),
    );
    database.close();
    return handle ?? null;
  } catch {
    return null;
  }
}

export function browserTailSourceId(): string {
  try {
    const stored = window.localStorage.getItem(SOURCE_ID_KEY);
    if (stored) {
      return stored;
    }

    const id = createSourceId();
    window.localStorage.setItem(SOURCE_ID_KEY, id);
    return id;
  } catch {
    return createSourceId();
  }
}

export function createNewBrowserTailSourceId(): string {
  const id = createSourceId();
  try {
    window.localStorage.setItem(SOURCE_ID_KEY, id);
  } catch {
    // The generated ID remains valid for the current tab.
  }
  return id;
}

export function isBrowserTailEnabled(): boolean {
  try {
    return window.localStorage.getItem(ENABLED_KEY) === "true";
  } catch {
    return false;
  }
}

export function setBrowserTailEnabled(enabled: boolean): void {
  try {
    window.localStorage.setItem(ENABLED_KEY, String(enabled));
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
    request.onerror = () => reject(request.error ?? new Error("Browser storage could not open"));
  });
}

function requestAsPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Browser storage request failed"));
  });
}
