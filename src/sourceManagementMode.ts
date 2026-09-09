import type { MachineSummary, RunSummary } from "./api";

export type SourceManagementMode = "viewer" | "manager";

export const SOURCE_MANAGEMENT_STORAGE_KEY = "freezedry.sourceManagement.mode";
export const DEFAULT_SOURCE_MANAGEMENT_MODE: SourceManagementMode = "viewer";

type StorageReader = Pick<Storage, "getItem">;
type StorageWriter = Pick<Storage, "setItem">;

export function parseSourceManagementMode(value: string | null): SourceManagementMode {
  return value === "manager" ? "manager" : DEFAULT_SOURCE_MANAGEMENT_MODE;
}

export function readSourceManagementMode(
  storage: StorageReader | null,
): SourceManagementMode {
  try {
    return parseSourceManagementMode(storage?.getItem(SOURCE_MANAGEMENT_STORAGE_KEY) ?? null);
  } catch {
    return DEFAULT_SOURCE_MANAGEMENT_MODE;
  }
}

export function writeSourceManagementMode(
  storage: StorageWriter | null,
  mode: SourceManagementMode,
): void {
  try {
    storage?.setItem(SOURCE_MANAGEMENT_STORAGE_KEY, mode);
  } catch {
    // The current page still keeps the selected mode when storage is unavailable.
  }
}

type MachineSelectionCandidate = Pick<
  MachineSummary,
  "active_run_id" | "id" | "last_sampled_at" | "run_count" | "source_count"
>;

type ServerDataCandidate = Omit<MachineSelectionCandidate, "id">;

export function hasServerMachineData(machine: ServerDataCandidate): boolean {
  return (
    machine.active_run_id !== null ||
    machine.last_sampled_at !== null ||
    machine.run_count > 0 ||
    machine.source_count > 0
  );
}

export function preferredMachineId(
  machines: readonly MachineSelectionCandidate[],
): number | null {
  const preferred = machines.reduce<MachineSelectionCandidate | null>((current, machine) => {
    if (!current) {
      return machine;
    }

    const activeDifference =
      Number(machine.active_run_id !== null) - Number(current.active_run_id !== null);
    if (activeDifference !== 0) {
      return activeDifference > 0 ? machine : current;
    }

    const sampledDifference =
      timestamp(machine.last_sampled_at) - timestamp(current.last_sampled_at);
    if (sampledDifference !== 0) {
      return sampledDifference > 0 ? machine : current;
    }

    const serverDataDifference =
      Number(hasServerMachineData(machine)) - Number(hasServerMachineData(current));
    return serverDataDifference > 0 ? machine : current;
  }, null);

  return preferred?.id ?? null;
}

type RunSelectionCandidate = Pick<RunSummary, "id" | "row_count">;

export function preferredRunId(
  runs: readonly RunSelectionCandidate[],
  activeRunId: number | null = null,
): number | null {
  if (activeRunId !== null && runs.some((run) => run.id === activeRunId)) {
    return activeRunId;
  }

  return runs.find((run) => run.row_count > 0)?.id ?? runs[0]?.id ?? null;
}

function timestamp(value: string | null): number {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? Number.NEGATIVE_INFINITY : parsed;
}
