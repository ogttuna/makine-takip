export function ChartState({
  actionLabel,
  message,
  onAction,
  title,
  tone = "idle",
}: {
  actionLabel?: string;
  message: string;
  onAction?: () => void;
  title: string;
  tone?: "idle" | "error";
}) {
  return (
    <div
      className={tone === "error" ? "chart-state error" : "chart-state"}
      role={tone === "error" ? "alert" : "status"}
    >
      <strong>{title}</strong>
      <span>{message}</span>
      {actionLabel && onAction ? (
        <button onClick={onAction} type="button">
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

export function InlineError({
  actionLabel,
  message,
  onAction,
  title,
}: {
  actionLabel: string;
  message: string;
  onAction: () => void;
  title: string;
}) {
  return (
    <div className="inline-error" role="alert">
      <strong>{title}</strong>
      <span>{message}</span>
      <button onClick={onAction} type="button">
        {actionLabel}
      </button>
    </div>
  );
}
