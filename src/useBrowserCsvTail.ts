import { useCallback, useEffect, useRef, useState } from "react";

import {
  fetchBrowserTailStatus,
  openBrowserTailFile,
  syncBrowserTailChunk,
  type BrowserTailStatus,
} from "./api";
import {
  browserTailSourceId,
  createNewBrowserTailSourceId,
  isBrowserTailEnabled,
  loadDirectoryHandle,
  saveDirectoryHandle,
  setBrowserTailEnabled,
} from "./browserTailStorage";

const SCAN_INTERVAL_MS = 30_000;
const MAX_CHUNK_BYTES = 512 * 1024;
const MAX_HEADER_BYTES = 64 * 1024;

export type BrowserCsvTailRuntimeStatus =
  | "stopped"
  | "permission_required"
  | "scanning"
  | "tailing"
  | "offline"
  | "degraded"
  | "unsupported";

export type BrowserCsvTailState = {
  supported: boolean;
  configured: boolean;
  enabled: boolean;
  status: BrowserCsvTailRuntimeStatus;
  directoryName: string | null;
  activeFileName: string | null;
  activeRunId: number | null;
  byteOffset: number | null;
  lastSourceSequence: number | null;
  lastSampledAt: string | null;
  lastScanAt: string | null;
  lastError: string | null;
};

type BrowserCsvTailOptions = {
  onSynced?: (runId: number | null, insertedCount: number) => void;
};

export function useBrowserCsvTail({ onSynced }: BrowserCsvTailOptions = {}) {
  const supported = typeof window.showDirectoryPicker === "function";
  const [state, setState] = useState<BrowserCsvTailState>(() => ({
    supported,
    configured: false,
    enabled: false,
    status: supported ? "stopped" : "unsupported",
    directoryName: null,
    activeFileName: null,
    activeRunId: null,
    byteOffset: null,
    lastSourceSequence: null,
    lastSampledAt: null,
    lastScanAt: null,
    lastError: null,
  }));
  const directoryRef = useRef<FileSystemDirectoryHandle | null>(null);
  const sourceIdRef = useRef(browserTailSourceId());
  const enabledRef = useRef(false);
  const scanningRef = useRef(false);
  const intervalRef = useRef<number | null>(null);
  const retryRef = useRef<number | null>(null);
  const retryAttemptRef = useRef(0);
  const onSyncedRef = useRef(onSynced);
  const scanNowRef = useRef<() => Promise<void>>(async () => undefined);

  onSyncedRef.current = onSynced;

  const clearTimers = useCallback(() => {
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (retryRef.current !== null) {
      window.clearTimeout(retryRef.current);
      retryRef.current = null;
    }
  }, []);

  const scheduleRetry = useCallback(() => {
    if (!enabledRef.current || retryRef.current !== null) {
      return;
    }

    const delay = Math.min(30_000, 5_000 * 2 ** retryAttemptRef.current);
    retryAttemptRef.current = Math.min(retryAttemptRef.current + 1, 3);
    retryRef.current = window.setTimeout(() => {
      retryRef.current = null;
      void scanNowRef.current();
    }, delay);
  }, []);

  const scanNow = useCallback(async () => {
    const directory = directoryRef.current;
    if (!directory || !enabledRef.current || scanningRef.current) {
      return;
    }

    scanningRef.current = true;
    setState((current) => ({
      ...current,
      status: "scanning",
      lastError: null,
    }));

    try {
      if (!navigator.onLine) {
        throw new Error("İnternet bağlantısı bekleniyor; CSV checkpoint'i korunuyor.");
      }

      const files = await csvFiles(directory);
      let serverStatus = await fetchBrowserTailStatus(sourceIdRef.current);
      let insertedCount = 0;

      if (files.length === 0) {
        if (retryRef.current !== null) {
          window.clearTimeout(retryRef.current);
          retryRef.current = null;
        }
        retryAttemptRef.current = 0;
        setState((current) => ({
          ...current,
          status: "tailing",
          lastScanAt: new Date().toISOString(),
          lastError: null,
        }));
        return;
      }

      const startIndex = scanStartIndex(files, serverStatus);
      for (let index = startIndex; index < files.length; index += 1) {
        const file = files[index];
        const header = await readHeader(file);
        const opened = await openBrowserTailFile({
          source_id: sourceIdRef.current,
          source_name: directory.name,
          file_name: file.name,
          header_line: header.line,
          header_end_offset: header.endOffset,
          file_size: file.size,
          last_modified_ms: file.lastModified,
        });

        if (opened.completed) {
          serverStatus = opened;
          continue;
        }

        const result = await syncFile(
          sourceIdRef.current,
          file,
          opened,
          index < files.length - 1,
        );
        serverStatus = result.status;
        insertedCount += result.insertedCount;
      }

      if (retryRef.current !== null) {
        window.clearTimeout(retryRef.current);
        retryRef.current = null;
      }
      retryAttemptRef.current = 0;
      const currentStatus = serverStatus;
      setState((current) => ({
        ...current,
        status: "tailing",
        directoryName: directory.name,
        activeFileName: currentStatus?.active_file_name ?? null,
        activeRunId: currentStatus?.active_run_id ?? null,
        byteOffset: currentStatus?.byte_offset ?? null,
        lastSourceSequence: currentStatus?.last_source_sequence ?? null,
        lastSampledAt: currentStatus?.last_sampled_at ?? null,
        lastScanAt: new Date().toISOString(),
        lastError: null,
      }));
      onSyncedRef.current?.(currentStatus?.active_run_id ?? null, insertedCount);
    } catch (error) {
      const message = errorMessage(error);
      const offline = !navigator.onLine || /fetch|network|internet|bağlantı/i.test(message);
      setState((current) => ({
        ...current,
        status: offline ? "offline" : "degraded",
        lastScanAt: new Date().toISOString(),
        lastError: message,
      }));
      scheduleRetry();
    } finally {
      scanningRef.current = false;
    }
  }, [scheduleRetry]);

  scanNowRef.current = scanNow;

  const startLoop = useCallback(
    (directory: FileSystemDirectoryHandle) => {
      directoryRef.current = directory;
      enabledRef.current = true;
      setBrowserTailEnabled(true);
      clearTimers();
      intervalRef.current = window.setInterval(() => {
        void scanNowRef.current();
      }, SCAN_INTERVAL_MS);
      setState((current) => ({
        ...current,
        configured: true,
        enabled: true,
        status: "scanning",
        directoryName: directory.name,
        lastError: null,
      }));
      void scanNowRef.current();
    },
    [clearTimers],
  );

  const chooseDirectory = useCallback(async () => {
    if (!window.showDirectoryPicker) {
      setState((current) => ({
        ...current,
        status: "unsupported",
        lastError: "Bu tarayıcı klasör takibini desteklemiyor. Chrome veya Edge kullanın.",
      }));
      return;
    }

    try {
      const directory = await window.showDirectoryPicker({
        id: "freezedry-machine-csv",
        mode: "read",
      });
      const previousDirectory = directoryRef.current;
      const isSameDirectory = previousDirectory
        ? await directory.isSameEntry(previousDirectory)
        : false;
      await saveDirectoryHandle(directory);
      if (!isSameDirectory) {
        sourceIdRef.current = createNewBrowserTailSourceId();
        setState((current) => ({
          ...current,
          activeFileName: null,
          activeRunId: null,
          byteOffset: null,
          lastSourceSequence: null,
          lastSampledAt: null,
          lastScanAt: null,
        }));
      }
      startLoop(directory);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      setState((current) => ({
        ...current,
        status: "degraded",
        lastError: errorMessage(error),
      }));
    }
  }, [startLoop]);

  const resume = useCallback(async () => {
    const directory = directoryRef.current ?? (await loadDirectoryHandle());
    if (!directory) {
      await chooseDirectory();
      return;
    }

    try {
      const permission = await directory.requestPermission({ mode: "read" });
      if (permission !== "granted") {
        setState((current) => ({
          ...current,
          configured: true,
          enabled: false,
          status: "permission_required",
          lastError: "Klasör izni verilmedi.",
        }));
        return;
      }

      startLoop(directory);
    } catch (error) {
      setState((current) => ({
        ...current,
        configured: true,
        enabled: false,
        status: "degraded",
        lastError: errorMessage(error),
      }));
    }
  }, [chooseDirectory, startLoop]);

  const stop = useCallback(() => {
    enabledRef.current = false;
    setBrowserTailEnabled(false);
    clearTimers();
    setState((current) => ({
      ...current,
      enabled: false,
      status: "stopped",
      lastError: null,
    }));
  }, [clearTimers]);

  useEffect(() => {
    if (!supported) {
      return;
    }

    let cancelled = false;
    void loadDirectoryHandle()
      .then(async (directory) => {
        if (cancelled || !directory) {
          return;
        }

        directoryRef.current = directory;
        const permission = await directory.queryPermission({ mode: "read" });
        if (cancelled) {
          return;
        }

        setState((current) => ({
          ...current,
          configured: true,
          directoryName: directory.name,
          status: permission === "granted" ? "stopped" : "permission_required",
        }));

        if (permission === "granted" && isBrowserTailEnabled()) {
          startLoop(directory);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setState((current) => ({
            ...current,
            status: "degraded",
            lastError: errorMessage(error),
          }));
        }
      });

    const wake = () => {
      if (enabledRef.current && navigator.onLine) {
        void scanNowRef.current();
      }
    };
    const visibility = () => {
      if (document.visibilityState === "visible") {
        wake();
      }
    };
    window.addEventListener("online", wake);
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", visibility);

    return () => {
      cancelled = true;
      clearTimers();
      window.removeEventListener("online", wake);
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [clearTimers, startLoop, supported]);

  return {
    state,
    chooseDirectory,
    resume,
    stop,
    rescan: scanNow,
  };
}

async function csvFiles(directory: FileSystemDirectoryHandle): Promise<File[]> {
  const files: File[] = [];
  for await (const [, entry] of directory.entries()) {
    if (entry.kind !== "file" || !entry.name.toLocaleLowerCase("en-US").endsWith(".csv")) {
      continue;
    }
    files.push(await (entry as FileSystemFileHandle).getFile());
  }

  files.sort(
    (left, right) => left.lastModified - right.lastModified || left.name.localeCompare(right.name),
  );
  return files;
}

function scanStartIndex(files: File[], status: BrowserTailStatus | null): number {
  if (!status?.active_file_name) {
    return 0;
  }

  const activeIndex = files.findIndex((file) => file.name === status.active_file_name);
  if (activeIndex >= 0) {
    return activeIndex;
  }

  const firstNewer = files.findIndex(
    (file) => file.lastModified > (status.last_modified_ms ?? 0),
  );
  return firstNewer >= 0 ? firstNewer : files.length;
}

async function readHeader(file: File): Promise<{ line: string; endOffset: number }> {
  const bytes = new Uint8Array(await file.slice(0, MAX_HEADER_BYTES).arrayBuffer());
  const newlineIndex = bytes.indexOf(10);
  if (newlineIndex < 0) {
    throw new Error(`${file.name}: tamamlanmış CSV başlığı bulunamadı.`);
  }

  let headerBytes = bytes.slice(0, newlineIndex);
  if (headerBytes.at(-1) === 13) {
    headerBytes = headerBytes.slice(0, -1);
  }
  const line = new TextDecoder("utf-8", { fatal: true })
    .decode(headerBytes)
    .replace(/^\uFEFF/, "")
    .trim();
  if (!line.split(";").map((column) => column.trim()).includes("TARIH SAAT")) {
    throw new Error(`${file.name}: TARIH SAAT kolonu bulunamadı.`);
  }

  return { line, endOffset: newlineIndex + 1 };
}

async function syncFile(
  sourceId: string,
  file: File,
  opened: BrowserTailStatus,
  acceptEof: boolean,
): Promise<{ status: BrowserTailStatus; insertedCount: number }> {
  let status = opened;
  let offset = opened.byte_offset ?? 0;
  let insertedCount = 0;

  while (offset < file.size) {
    const end = Math.min(file.size, offset + MAX_CHUNK_BYTES);
    const bytes = new Uint8Array(await file.slice(offset, end).arrayBuffer());
    const isEndOfSnapshot = end === file.size;
    const consumed =
      acceptEof && isEndOfSnapshot ? bytes.length : completeLinePrefixLength(bytes);

    if (consumed === 0) {
      if (bytes.length === MAX_CHUNK_BYTES) {
        throw new Error(`${file.name}: tek CSV satırı ${MAX_CHUNK_BYTES} byte sınırını aşıyor.`);
      }
      break;
    }

    const rowsText = new TextDecoder("utf-8", { fatal: true }).decode(bytes.slice(0, consumed));
    const response = await syncBrowserTailChunk({
      source_id: sourceId,
      file_name: file.name,
      offset,
      rows_text: rowsText,
    });
    status = response;
    insertedCount += response.inserted_count;

    const acknowledgedOffset = response.byte_offset ?? offset;
    if (acknowledgedOffset <= offset) {
      throw new Error(`${file.name}: sunucu CSV checkpoint'ini ilerletmedi.`);
    }
    offset = acknowledgedOffset;
  }

  return { status, insertedCount };
}

function completeLinePrefixLength(bytes: Uint8Array): number {
  for (let index = bytes.length - 1; index >= 0; index -= 1) {
    if (bytes[index] === 10) {
      return index + 1;
    }
  }
  return 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "CSV klasörü okunamadı.";
}
