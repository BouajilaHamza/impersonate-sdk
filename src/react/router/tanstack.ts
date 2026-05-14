"use client";
import { useNavigate } from "@tanstack/react-router";
import type { StopReason } from "../../core/types";

/**
 * Router handoff for TanStack Router.
 *
 * Returns `onStart` / `onStop` callbacks that navigate to the user view on
 * start and back to the admin view on stop. Spread the result into
 * `<ImpersonationProvider>`.
 *
 * @example
 * ```tsx
 * const handoff = useTanstackHandoff({
 *   adminPath: "/admin/users",
 *   userPath: "/",
 * });
 *
 * <ImpersonationProvider manager={manager} {...handoff}>
 *   {children}
 * </ImpersonationProvider>
 * ```
 */
export function useTanstackHandoff(opts: {
  adminPath: string;
  userPath: string;
}): {
  onStart: (targetDisplayName: string) => void;
  onStop: (reason: StopReason) => void;
} {
  const navigate = useNavigate();
  return {
    onStart: () => {
      navigate({ to: opts.userPath });
    },
    onStop: () => {
      navigate({ to: opts.adminPath });
    },
  };
}
