"use client";
import { useNavigate } from "react-router";
import type { StopReason } from "../../core/types";

/**
 * Router handoff for react-router v6+ / v7.
 *
 * Returns `onStart` / `onStop` callbacks that navigate to the user view on
 * start and back to the admin view on stop. Spread the result into
 * `<ImpersonationProvider>`.
 *
 * @example
 * ```tsx
 * const handoff = useReactRouterHandoff({
 *   adminPath: "/admin/users",
 *   userPath: "/",
 * });
 *
 * <ImpersonationProvider manager={manager} {...handoff}>
 *   {children}
 * </ImpersonationProvider>
 * ```
 */
export function useReactRouterHandoff(opts: {
  adminPath: string;
  userPath: string;
}): {
  onStart: (targetDisplayName: string) => void;
  onStop: (reason: StopReason) => void;
} {
  const navigate = useNavigate();
  return {
    onStart: () => navigate(opts.userPath),
    onStop: () => navigate(opts.adminPath),
  };
}
