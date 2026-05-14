import { useEffect, useRef, useState, useCallback, type ReactNode } from "react";
import { ImpersonationManager } from "../core/ImpersonationManager";
import type { ImpersonationConfig, ImpersonationState, StopReason } from "../core/types";
import { ImpersonationContext } from "./ImpersonationContext";

export type ImpersonationProviderProps = {
  /** Called after impersonation starts successfully. */
  onStart?: (targetDisplayName: string) => void;

  /** Called after impersonation stops. */
  onStop?: (reason: StopReason) => void;

  /** Called when an error occurs during impersonation lifecycle. */
  onError?: (error: Error, phase: "start" | "stop" | "extend") => void;

  children: ReactNode;
} & (
  | {
      /** A pre-built ImpersonationManager instance. */
      manager: ImpersonationManager;
      config?: never;
    }
  | {
      manager?: never;
      /** Config to create the manager internally. The manager is created once and destroyed on unmount. */
      config: ImpersonationConfig;
    }
);

export function ImpersonationProvider(props: ImpersonationProviderProps) {
  const { onStart, onStop, onError, children } = props;

  // Create or use the provided manager (stable across re-renders)
  const managerRef = useRef<ImpersonationManager | null>(null);
  const ownsManager = useRef(false);
  if (!managerRef.current) {
    if (props.manager) {
      managerRef.current = props.manager;
    } else {
      managerRef.current = new ImpersonationManager(props.config!);
      ownsManager.current = true;
    }
  }
  const manager = managerRef.current;

  const [state, setState] = useState<ImpersonationState>(manager.getState());

  // Keep callbacks in refs so event listeners always see the latest
  const onStartRef = useRef(onStart);
  const onStopRef = useRef(onStop);
  const onErrorRef = useRef(onError);
  onStartRef.current = onStart;
  onStopRef.current = onStop;
  onErrorRef.current = onError;

  useEffect(() => {
    // Subscribe to all relevant events
    const unsubs: Array<() => void> = [];

    unsubs.push(
      manager.on("statechange", ({ state: newState }) => {
        setState(newState);
      })
    );

    unsubs.push(
      manager.on("started", ({ targetDisplayName }) => {
        onStartRef.current?.(targetDisplayName);
      })
    );

    unsubs.push(
      manager.on("stopped", ({ reason }) => {
        onStopRef.current?.(reason);
      })
    );

    unsubs.push(
      manager.on("error", ({ error, phase }) => {
        onErrorRef.current?.(error, phase);
      })
    );

    // Check for orphaned sessions on mount
    const isOrphan = manager.checkForOrphan();
    if (isOrphan) {
      onStopRef.current?.("orphan");
    }

    // Sync initial state (may have been rehydrated)
    setState(manager.getState());

    return () => {
      unsubs.forEach((unsub) => unsub());
      // Destroy the manager if we created it
      if (ownsManager.current) {
        manager.destroy();
      }
    };
  }, [manager]);

  const start = useCallback(
    (targetUserId: string) => manager.start(targetUserId),
    [manager]
  );

  const stop = useCallback(() => manager.stop("manual"), [manager]);

  const extend = useCallback(() => manager.extend(), [manager]);

  return (
    <ImpersonationContext.Provider value={{ state, start, stop, extend }}>
      {children}
    </ImpersonationContext.Provider>
  );
}
