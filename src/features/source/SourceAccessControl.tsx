import type { AppCopy } from "../../i18n";

export function SourceAccessControl({
  copy,
  isUnlocked,
  onToggle,
  variant = "rail",
}: {
  copy: AppCopy["fleet"]["sourceAccess"];
  isUnlocked: boolean;
  onToggle: () => void;
  variant?: "rail" | "panel";
}) {
  return (
    <div
      className={`source-access-control ${variant} ${isUnlocked ? "unlocked" : "locked"}`}
    >
      <span className="source-lock-glyph" aria-hidden="true" />
      <span className="source-access-copy">
        <strong>{isUnlocked ? copy.unlockedTitle : copy.lockedTitle}</strong>
        <small>{isUnlocked ? copy.unlockedHint : copy.lockedHint}</small>
      </span>
      <button
        aria-label={isUnlocked ? copy.lockAria : copy.unlockAria}
        aria-pressed={isUnlocked}
        className="source-access-toggle"
        onClick={onToggle}
        type="button"
      >
        {isUnlocked ? copy.lock : copy.unlock}
      </button>
    </div>
  );
}
