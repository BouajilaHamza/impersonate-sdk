// Main entry point re-exports core
export {
  ImpersonationManager,
  EventEmitter,
  StorageManager,
  TimerManager,
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
