import type { CSSProperties, ReactNode } from "react";
import { useImpersonation } from "./useImpersonation";

// ── Inline SVG Icons (no lucide-react dependency) ──────────────────

const EyeIcon = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const ClockIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="10" />
    <polyline points="12 6 12 12 16 14" />
  </svg>
);

const XIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
);

const PlusIcon = () => (
  <svg
    width="12"
    height="12"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M5 12h14" />
    <path d="M12 5v14" />
  </svg>
);

// ── Styles ─────────────────────────────────────────────────────────

const styles = {
  banner: {
    position: "sticky",
    top: 0,
    zIndex: 9999,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "12px",
    padding: "8px 16px",
    fontFamily:
      '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    fontSize: "12px",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    transition: "background-color 0.2s, color 0.2s",
  } satisfies CSSProperties,

  bannerNormal: {
    backgroundColor: "var(--imp-banner-bg, #f59e0b)",
    color: "var(--imp-banner-text, #451a03)",
  } satisfies CSSProperties,

  bannerUrgent: {
    backgroundColor: "var(--imp-banner-urgent-bg, #ef4444)",
    color: "var(--imp-banner-urgent-text, #ffffff)",
  } satisfies CSSProperties,

  label: {
    display: "flex",
    alignItems: "center",
    gap: "6px",
    flexShrink: 0,
  } satisfies CSSProperties,

  timer: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    borderRadius: "9999px",
    padding: "2px 8px",
    fontSize: "12px",
    fontWeight: 700,
    fontVariantNumeric: "tabular-nums",
  } satisfies CSSProperties,

  timerNormal: {
    backgroundColor: "var(--imp-timer-bg, rgba(217, 119, 6, 0.5))",
    color: "var(--imp-timer-text, #451a03)",
  } satisfies CSSProperties,

  timerUrgent: {
    backgroundColor: "var(--imp-timer-urgent-bg, #b91c1c)",
    color: "var(--imp-timer-urgent-text, #ffffff)",
    animation: "imp-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
  } satisfies CSSProperties,

  button: {
    display: "inline-flex",
    alignItems: "center",
    gap: "4px",
    height: "24px",
    padding: "0 8px",
    borderRadius: "4px",
    border: "1px solid",
    fontSize: "11px",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    cursor: "pointer",
    transition: "background-color 0.15s",
    lineHeight: 1,
  } satisfies CSSProperties,

  endButtonNormal: {
    borderColor: "var(--imp-end-border, #92400e)",
    backgroundColor: "var(--imp-end-bg, #d97706)",
    color: "var(--imp-end-text, #451a03)",
  } satisfies CSSProperties,

  endButtonUrgent: {
    borderColor: "var(--imp-end-border-urgent, rgba(255,255,255,0.4))",
    backgroundColor: "var(--imp-end-bg-urgent, rgba(255,255,255,0.2))",
    color: "var(--imp-end-text-urgent, #ffffff)",
  } satisfies CSSProperties,

  extendButton: {
    borderColor: "rgba(255,255,255,0.4)",
    backgroundColor: "rgba(255,255,255,0.2)",
    color: "#ffffff",
  } satisfies CSSProperties,

  maxTimeLabel: {
    fontSize: "11px",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.05em",
    opacity: 0.75,
  } satisfies CSSProperties,
} as const;

// Inject pulse keyframes if not already present
const STYLE_ID = "imp-sdk-keyframes";
function ensureKeyframes() {
  if (typeof document === "undefined") return;
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `@keyframes imp-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }`;
  document.head.appendChild(style);
}

// ── Component ──────────────────────────────────────────────────────

export interface ImpersonationBannerProps {
  /** Called when the user clicks "End". If not provided, calls stop() only. */
  onEnd?: () => void | Promise<void>;

  /** Label for the extend button. Default: "Extend 15 min". */
  extendLabel?: string;

  /** Label for the end button. Default: "End Impersonation". */
  endLabel?: string;

  /** Text when max time is reached. Default: "Max time reached". */
  maxTimeLabel?: string;

  /** Seconds threshold for urgent styling. Default: uses manager config. */
  urgentThreshold?: number;

  /** Additional CSS class name. */
  className?: string;

  /** Additional inline styles for the root element. */
  style?: CSSProperties;

  /**
   * Headless render prop. When provided, the default banner is not rendered.
   * Use this to build a fully custom banner.
   */
  render?: (props: {
    isActive: boolean;
    targetDisplayName: string | null;
    remainingSeconds: number | null;
    canExtend: boolean;
    isUrgent: boolean;
    formatTime: (seconds: number) => string;
    onExtend: () => void;
    onEnd: () => void;
  }) => ReactNode;
}

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

export function ImpersonationBanner({
  onEnd: onEndProp,
  extendLabel = "Extend 15 min",
  endLabel = "End Impersonation",
  maxTimeLabel = "Max time reached",
  className,
  style: styleProp,
  render,
}: ImpersonationBannerProps) {
  ensureKeyframes();

  const {
    isActive,
    targetDisplayName,
    remainingSeconds,
    canExtend,
    isUrgent,
    stop,
    extend,
  } = useImpersonation();

  const handleEnd = async () => {
    if (onEndProp) {
      await onEndProp();
    } else {
      await stop();
    }
  };

  if (!isActive) return null;

  // Headless mode
  if (render) {
    return (
      <>
        {render({
          isActive,
          targetDisplayName,
          remainingSeconds,
          canExtend,
          isUrgent,
          formatTime,
          onExtend: extend,
          onEnd: handleEnd,
        })}
      </>
    );
  }

  const displayName = targetDisplayName || "another user";
  const showExtendButton = canExtend && remainingSeconds !== null && remainingSeconds > 0;

  return (
    <div
      className={className}
      style={{
        ...styles.banner,
        ...(isUrgent ? styles.bannerUrgent : styles.bannerNormal),
        ...styleProp,
      }}
      role="status"
      aria-live="polite"
    >
      <span style={styles.label}>
        <EyeIcon />
        <span>
          Viewing as <strong>{displayName}</strong>
        </span>
      </span>

      {remainingSeconds !== null && (
        <span
          style={{
            ...styles.timer,
            ...(isUrgent ? styles.timerUrgent : styles.timerNormal),
          }}
        >
          <ClockIcon />
          {formatTime(remainingSeconds)}
        </span>
      )}

      {showExtendButton &&
        (canExtend ? (
          <button
            onClick={extend}
            style={{ ...styles.button, ...styles.extendButton }}
            type="button"
          >
            <PlusIcon />
            {extendLabel}
          </button>
        ) : (
          <span style={styles.maxTimeLabel}>{maxTimeLabel}</span>
        ))}

      <button
        onClick={handleEnd}
        style={{
          ...styles.button,
          ...(isUrgent ? styles.endButtonUrgent : styles.endButtonNormal),
          marginLeft: "8px",
        }}
        type="button"
      >
        <XIcon />
        {endLabel}
      </button>
    </div>
  );
}
