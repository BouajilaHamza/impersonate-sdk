import type { ImpersonationEventMap, ImpersonationEventName } from "./types";

type Handler<T> = (data: T) => void;

export class EventEmitter {
  private listeners = new Map<string, Set<Handler<any>>>();

  on<E extends ImpersonationEventName>(
    event: E,
    handler: Handler<ImpersonationEventMap[E]>
  ): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    return () => this.off(event, handler);
  }

  off<E extends ImpersonationEventName>(
    event: E,
    handler: Handler<ImpersonationEventMap[E]>
  ): void {
    this.listeners.get(event)?.delete(handler);
  }

  emit<E extends ImpersonationEventName>(
    event: E,
    data: ImpersonationEventMap[E]
  ): void {
    this.listeners.get(event)?.forEach((handler) => {
      try {
        handler(data);
      } catch (err) {
        console.error(`[impersonate-sdk] Error in "${event}" handler:`, err);
      }
    });
  }

  removeAllListeners(): void {
    this.listeners.clear();
  }
}
