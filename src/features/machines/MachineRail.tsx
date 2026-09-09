import { useEffect, useRef, useState } from "react";

import type { CreateMachinePayload, MachineSummary } from "../../api";
import { InlineError } from "../../components/StatusViews";
import type { AppCopy, Locale } from "../../i18n";
import { hasServerMachineData } from "../../sourceManagementMode";
import {
  type BrowserCsvTailState,
  useBrowserCsvTail,
} from "../../useBrowserCsvTail";
import { formatDate } from "../../utils/format";
import { SourceAccessControl } from "../source/SourceAccessControl";

type MachineRailProps = {
  copy: AppCopy["fleet"];
  createError: Error | null;
  error: Error | null;
  isCreating: boolean;
  isLoading: boolean;
  isSourceManagementUnlocked: boolean;
  locale: Locale;
  machines: MachineSummary[];
  onCreate: (payload: CreateMachinePayload) => Promise<void>;
  onRetry: () => void;
  onRuntimeChange: (machineId: number, state: BrowserCsvTailState) => void;
  onSelect: (machineId: number) => void;
  onSynced: (
    machineId: number,
    runId: number | null,
    insertedCount: number,
    rejectedCount: number,
  ) => void;
  onToggleSourceManagement: () => void;
  selectedMachineId: number | null;
};

export function MachineRail({
  copy,
  createError,
  error,
  isCreating,
  isLoading,
  isSourceManagementUnlocked,
  locale,
  machines,
  onCreate,
  onRetry,
  onRuntimeChange,
  onSelect,
  onSynced,
  onToggleSourceManagement,
  selectedMachineId,
}: MachineRailProps) {
  const [showForm, setShowForm] = useState(false);
  const machineListRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const list = machineListRef.current;
    if (
      !list ||
      selectedMachineId === null ||
      !window.matchMedia("(max-width: 840px)").matches
    ) {
      return;
    }

    const selectedCard = list.querySelector<HTMLElement>(
      `[data-machine-id="${selectedMachineId}"]`,
    );
    if (!selectedCard) {
      return;
    }

    const listRect = list.getBoundingClientRect();
    const cardRect = selectedCard.getBoundingClientRect();
    if (cardRect.left >= listRect.left && cardRect.right <= listRect.right) {
      return;
    }

    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    list.scrollTo({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      left: Math.max(0, list.scrollLeft + cardRect.left - listRect.left - 8),
    });
  }, [machines.length, selectedMachineId]);

  return (
    <aside className="machine-rail" aria-label={copy.title}>
      <div className="machine-rail-heading">
        <div>
          <span>{copy.title}</span>
          <strong>{copy.count(machines.length)}</strong>
        </div>
        <button
          aria-expanded={showForm}
          aria-label={showForm ? copy.closeForm : copy.add}
          className="rail-add-button"
          onClick={() => setShowForm((current) => !current)}
          type="button"
        >
          {showForm ? "×" : "+"}
        </button>
      </div>

      <SourceAccessControl
        copy={copy.sourceAccess}
        isUnlocked={isSourceManagementUnlocked}
        onToggle={onToggleSourceManagement}
      />

      {showForm ? (
        <div className="machine-form-reveal open">
          <div>
            <MachineForm
              copy={copy}
              error={createError}
              isCreating={isCreating}
              onCreate={async (payload) => {
                await onCreate(payload);
                setShowForm(false);
              }}
            />
          </div>
        </div>
      ) : null}

      {isLoading ? <p className="rail-state">{copy.loading}</p> : null}
      {error ? (
        <InlineError
          actionLabel={locale === "en" ? "Retry" : "Tekrar dene"}
          message={error.message}
          onAction={onRetry}
          title={copy.loadError}
        />
      ) : null}
      {!isLoading && !error && machines.length === 0 ? (
        <p className="rail-state">{copy.empty}</p>
      ) : null}

      <div className="machine-list" ref={machineListRef}>
        {machines.map((machine) => (
          <MachineCard
            copy={copy}
            isSelected={machine.id === selectedMachineId}
            isSourceManagementUnlocked={isSourceManagementUnlocked}
            key={machine.id}
            locale={locale}
            machine={machine}
            onRuntimeChange={onRuntimeChange}
            onSelect={onSelect}
            onSynced={onSynced}
          />
        ))}
      </div>

      <p className="machine-rail-footnote">{copy.sourceHint}</p>
    </aside>
  );
}

function MachineCard({
  copy,
  isSelected,
  isSourceManagementUnlocked,
  locale,
  machine,
  onRuntimeChange,
  onSelect,
  onSynced,
}: {
  copy: AppCopy["fleet"];
  isSelected: boolean;
  isSourceManagementUnlocked: boolean;
  locale: Locale;
  machine: MachineSummary;
  onRuntimeChange: (machineId: number, state: BrowserCsvTailState) => void;
  onSelect: (machineId: number) => void;
  onSynced: MachineRailProps["onSynced"];
}) {
  const tail = useBrowserCsvTail({
    machineId: machine.id,
    onSynced: (runId, insertedCount, rejectedCount) =>
      onSynced(machine.id, runId, insertedCount, rejectedCount),
  });

  useEffect(() => {
    onRuntimeChange(machine.id, tail.state);
  }, [machine.id, onRuntimeChange, tail.state]);

  const presentation = machineStatus(machine, tail.state, copy);
  const lastData = tail.state.lastSampledAt ?? machine.last_sampled_at;

  return (
    <section
      className={isSelected ? "machine-card selected" : "machine-card"}
      data-machine-id={machine.id}
    >
      <button
        aria-label={copy.select(machine.name)}
        className="machine-select"
        onClick={() => onSelect(machine.id)}
        type="button"
      >
        <span className={`machine-status-dot ${presentation.tone}`} aria-hidden="true" />
        <span className="machine-identity">
          <strong>{machine.name}</strong>
          <small>
            {machine.code} · {machine.model ?? "FD"}
          </small>
        </span>
        <span className={`machine-status-label ${presentation.tone}`}>
          {presentation.label}
        </span>
      </button>

      <div className="machine-card-meta">
        <span>{machine.location ?? copy.noLocation}</span>
        <span>{copy.runs(machine.run_count)}</span>
        {machine.warning_count + machine.error_count > 0 ? (
          <strong>{copy.issues(machine.warning_count + machine.error_count)}</strong>
        ) : null}
      </div>

      <div className={isSelected ? "machine-source-reveal open" : "machine-source-reveal"}>
        <div>
          <div className="machine-source">
            <div className="machine-source-name">
              <span>
                {tail.state.directoryName ??
                  (hasServerMachineData(machine)
                    ? copy.remoteSource
                    : isSourceManagementUnlocked
                      ? copy.waitingFolder
                      : copy.waitingServerSource)}
              </span>
              <strong>
                {tail.state.activeFileName
                  ? copy.liveFile(tail.state.activeFileName)
                  : machine.active_run_name
                    ? copy.liveFile(machine.active_run_name)
                  : lastData
                    ? copy.lastData(formatDate(lastData, locale))
                    : presentation.label}
              </strong>
            </div>
            {isSelected && isSourceManagementUnlocked ? (
              <div className="machine-source-actions">
                {!tail.state.configured ? (
                  <button
                    disabled={!tail.state.supported || tail.state.status === "scanning"}
                    onClick={() => void tail.chooseDirectory()}
                    type="button"
                  >
                    {copy.chooseFolder}
                  </button>
                ) : null}
                {tail.state.configured && !tail.state.enabled ? (
                  <button
                    disabled={!tail.state.supported || tail.state.status === "scanning"}
                    onClick={() => void tail.resume()}
                    type="button"
                  >
                    {copy.resume}
                  </button>
                ) : null}
                {tail.state.enabled ? (
                  <button onClick={tail.stop} type="button">
                    {copy.stop}
                  </button>
                ) : null}
                {tail.state.enabled ? (
                  <button
                    disabled={tail.state.status === "scanning"}
                    onClick={() => void tail.rescan()}
                    type="button"
                  >
                    {copy.scan}
                  </button>
                ) : null}
                {tail.state.configured ? (
                  <button
                    disabled={!tail.state.supported || tail.state.status === "scanning"}
                    onClick={() => void tail.chooseDirectory()}
                    type="button"
                  >
                    {copy.changeFolder}
                  </button>
                ) : null}
              </div>
            ) : null}
            {isSelected &&
            tail.state.lastError &&
            (isSourceManagementUnlocked || tail.state.configured) ? (
              <p className="machine-source-error" role="alert">
                {tail.state.lastError}
              </p>
            ) : null}
          </div>
        </div>
      </div>
    </section>
  );
}

function MachineForm({
  copy,
  error,
  isCreating,
  onCreate,
}: {
  copy: AppCopy["fleet"];
  error: Error | null;
  isCreating: boolean;
  onCreate: (payload: CreateMachinePayload) => Promise<void>;
}) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [model, setModel] = useState("FD-750");
  const [location, setLocation] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  return (
    <form
      className="machine-form"
      onSubmit={(event) => {
        event.preventDefault();
        setLocalError(null);
        void onCreate({ code, name, model, location }).catch((createError: unknown) => {
          setLocalError(
            createError instanceof Error ? createError.message : "Machine could not be created",
          );
        });
      }}
    >
      <label>
        <span>{copy.code}</span>
        <input
          autoComplete="off"
          disabled={isCreating}
          maxLength={48}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder={copy.codePlaceholder}
          required
          value={code}
        />
      </label>
      <label>
        <span>{copy.name}</span>
        <input
          disabled={isCreating}
          maxLength={120}
          onChange={(event) => setName(event.target.value)}
          placeholder={copy.namePlaceholder}
          required
          value={name}
        />
      </label>
      <div className="machine-form-row">
        <label>
          <span>{copy.model}</span>
          <input
            disabled={isCreating}
            maxLength={80}
            onChange={(event) => setModel(event.target.value)}
            placeholder={copy.modelPlaceholder}
            value={model}
          />
        </label>
        <label>
          <span>{copy.location}</span>
          <input
            disabled={isCreating}
            maxLength={160}
            onChange={(event) => setLocation(event.target.value)}
            placeholder={copy.locationPlaceholder}
            value={location}
          />
        </label>
      </div>
      {localError ?? error?.message ? (
        <p className="machine-form-error" role="alert">
          {localError ?? error?.message}
        </p>
      ) : null}
      <button className="machine-create-button" disabled={isCreating} type="submit">
        {isCreating ? copy.creating : copy.create}
      </button>
    </form>
  );
}

function machineStatus(
  machine: MachineSummary,
  state: BrowserCsvTailState,
  copy: AppCopy["fleet"],
): { label: string; tone: string } {
  if (machine.status === "inactive") {
    return { label: copy.statuses.inactive, tone: "muted" };
  }
  if (state.status === "degraded" || state.status === "offline" || state.lastError) {
    return { label: copy.statuses.attention, tone: "attention" };
  }
  if (state.status === "scanning") {
    return { label: copy.statuses.scanning, tone: "scanning" };
  }
  if (state.status === "tailing") {
    return { label: copy.statuses.live, tone: "live" };
  }
  if (machine.active_run_id !== null) {
    return { label: copy.statuses.live, tone: "live" };
  }
  if (state.configured || hasServerMachineData(machine)) {
    return { label: copy.statuses.paused, tone: "paused" };
  }
  return { label: copy.statuses.unconfigured, tone: "muted" };
}
