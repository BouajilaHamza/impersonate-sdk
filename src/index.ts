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
  StorageBackend,
  StorageArea,
} from "./core";
