import { useContext } from "react";
import { ImpersonationContext } from "./ImpersonationContext";

/**
 * Access impersonation state and actions from any component.
 *
 * Must be used within an `<ImpersonationProvider>`.
 *
 * @example
 * ```tsx
 * const { isActive, targetDisplayName, start, stop } = useImpersonation();
 *
 * return isActive
 *   ? <p>Viewing as {targetDisplayName}</p>
 *   : <button onClick={() => start(userId)}>Impersonate</button>;
 * ```
 */
export function useImpersonation() {
  const ctx = useContext(ImpersonationContext);

  if (!ctx) {
    throw new Error(
      "useImpersonation() must be used within an <ImpersonationProvider>. " +
        "Wrap your app with <ImpersonationProvider manager={...}>."
    );
  }

  const { state, start, stop, extend } = ctx;

  return {
    /** Whether impersonation is currently active. */
    isActive: state.status === "active",

    /** Whether a start/stop transition is in progress. */
    isTransitioning:
      state.status === "starting" || state.status === "stopping",

    /** Current state machine status. */
    status: state.status,

    /** Display name of the impersonated user. */
    targetDisplayName: state.targetDisplayName,

    /** Optional metadata from the adapter. */
    metadata: state.metadata,

    /** Seconds remaining before auto-expiry. */
    remainingSeconds: state.remainingSeconds,

    /** Milliseconds remaining before auto-expiry. */
    remainingMs: state.remainingMs,

    /** Whether the timer can be extended. */
    canExtend: state.canExtend,

    /** Whether we're in the urgent phase (close to expiry). */
    isUrgent: state.isUrgent,

    /** Start impersonating a user. */
    start,

    /** Stop impersonating and restore admin session. */
    stop,

    /** Extend the impersonation timer. */
    extend,
  };
}
