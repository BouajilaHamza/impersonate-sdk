import { createContext } from "react";
import type { ImpersonationState } from "../core/types";

export interface ImpersonationContextValue {
  state: ImpersonationState;
  start: (targetUserId: string) => Promise<void>;
  stop: () => Promise<void>;
  extend: () => void;
}

export const ImpersonationContext =
  createContext<ImpersonationContextValue | null>(null);

ImpersonationContext.displayName = "ImpersonationContext";
