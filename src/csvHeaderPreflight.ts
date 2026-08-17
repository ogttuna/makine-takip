const MAX_HEADER_BYTES = 64 * 1024;

export type PreparedCsvFile = {
  file: File;
  header: { line: string; endOffset: number };
};

export type CsvHeaderIssue = {
  fileName: string;
  message: string;
};

class IncompleteCsvHeaderError extends Error {
  override name = "IncompleteCsvHeaderError";
}

export async function prepareCsvFilesForScan(
  files: File[],
  isDatedDailyLog: (fileName: string) => boolean,
): Promise<{ files: PreparedCsvFile[]; issues: CsvHeaderIssue[] }> {
  const preparedFiles: PreparedCsvFile[] = [];
  const issues: CsvHeaderIssue[] = [];

  for (const file of files) {
    try {
      preparedFiles.push({ file, header: await readHeader(file, isDatedDailyLog) });
    } catch (error) {
      issues.push({ fileName: file.name, message: errorMessage(error) });
      if (error instanceof IncompleteCsvHeaderError) {
        break;
      }
    }
  }

  return { files: preparedFiles, issues };
}

async function readHeader(
  file: File,
  isDatedDailyLog: (fileName: string) => boolean,
): Promise<{ line: string; endOffset: number }> {
  const bytes = new Uint8Array(await file.slice(0, MAX_HEADER_BYTES).arrayBuffer());
  const newlineIndex = bytes.indexOf(10);
  if (newlineIndex < 0) {
    if (file.size > MAX_HEADER_BYTES) {
      throw new Error(`${file.name}: CSV başlığı ${MAX_HEADER_BYTES} byte sınırını aşıyor.`);
    }
    throw new IncompleteCsvHeaderError(
      `${file.name}: CSV başlığı henüz tamamlanmadı; sonraki dosyalara geçmeden bekleniyor.`,
    );
  }

  let headerBytes = bytes.slice(0, newlineIndex);
  if (headerBytes.at(-1) === 13) {
    headerBytes = headerBytes.slice(0, -1);
  }
  const line = new TextDecoder("utf-8", { fatal: true })
    .decode(headerBytes)
    .replace(/^\uFEFF/, "")
    .trim();
  const columns = line
    .split(";")
    .map((column) => column.trim().replace(/^"(.*)"$/, "$1").toLocaleUpperCase("tr-TR"));
  const hasFullTimestamp = columns.includes("TARİH SAAT") || columns.includes("TARIH SAAT");
  const hasTimeOnly = columns.includes("SAAT");

  if (hasFullTimestamp === hasTimeOnly) {
    throw new Error(`${file.name}: TARIH SAAT veya SAAT kolonlarından yalnız biri bulunmalı.`);
  }
  if (hasTimeOnly && !isDatedDailyLog(file.name)) {
    throw new Error(`${file.name}: SAAT kolonu için dosya adı LogFile_YYYY_MM_DD.csv olmalı.`);
  }

  return { line, endOffset: newlineIndex + 1 };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "CSV başlığı okunamadı.";
}
