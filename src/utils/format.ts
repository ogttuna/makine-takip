import type { RunSummary } from "../api";
import type { Locale } from "../i18n";

export function runRangeLabel(run: RunSummary | null, locale: Locale = "tr"): string {
  if (!run?.started_at || !run.finished_at) {
    return locale === "en"
      ? "Import a run to review samples."
      : "Örnekleri incelemek için bir çalışma içe aktar.";
  }

  return `${formatDate(run.started_at, locale)} - ${formatDate(run.finished_at, locale)}`;
}

export function durationLabel(run: RunSummary | null, locale: Locale = "tr"): string {
  if (!run?.started_at || !run.finished_at) {
    return "-";
  }

  const start = Date.parse(run.started_at);
  const end = Date.parse(run.finished_at);

  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
    return "-";
  }

  const totalMinutes = Math.round((end - start) / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) {
    return locale === "en" ? `${minutes} min` : `${minutes} dk`;
  }

  return locale === "en" ? `${hours} h ${minutes} min` : `${hours} sa ${minutes} dk`;
}

export function shortDate(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  return formatDate(value);
}

export function formatDate(value: string, locale: Locale = "tr"): string {
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "tr-TR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function runStatusLabel(status: string, locale: Locale = "tr"): string {
  if (status === "imported") {
    return locale === "en" ? "imported" : "içe aktarıldı";
  }

  return status;
}

export function sourceKindLabel(sourceKind: string, locale: Locale = "tr"): string {
  if (sourceKind === "csv_import") {
    return locale === "en" ? "CSV import" : "CSV içe aktarma";
  }

  if (sourceKind === "csv_tail") {
    return locale === "en" ? "Live CSV" : "Canlı CSV";
  }

  return sourceKind;
}

export function formatSeconds(value: number, locale: Locale = "tr"): string {
  return `${new Intl.NumberFormat(locale === "en" ? "en-US" : "tr-TR", {
    maximumFractionDigits: 3,
  }).format(value)} ${locale === "en" ? "s" : "sn"}`;
}

export function formatMachineTimestamp(value: string, locale: Locale = "tr"): string {
  const match = value.match(/^(\d{4})-(\d{2})-(\d{2})[T-](.+?)(?:Z)?$/);

  if (!match) {
    return value;
  }

  if (locale === "en") {
    return `${match[1]}-${match[2]}-${match[3]} ${match[4]}`;
  }

  return `${match[3]}.${match[2]}.${match[1]} ${match[4]}`;
}
