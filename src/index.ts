// Main entry point re-exports core
export {
  ImpersonationManager,
  DEFAULTS,
} from "./core";

export type {
  ImpersonationAdapter,
  ImpersonationConfig,
  ImpersonationState,
  ImpersonationStatus,
  ImpersonationResult,
  ImpersonationEventMap,
  ImpersonationEventName,
  SessionSnapshot,
  StopReason,
  StorageBackend,
  StorageArea,
} from "./core";
