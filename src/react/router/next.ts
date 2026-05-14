"use client";
import { useRouter } from "next/navigation";

/**
 * Router handoff for the Next.js App Router (`next/navigation`).
 *
 * Returns `onStart` / `onStop` callbacks that navigate to the user view on
 * start and back to the admin view on stop. Spread the result into
 * `<ImpersonationProvider>`.
 *
 * @example
 * ```tsx
 * "use client";
 * const handoff = useNextHandoff({
 *   adminPath: "/admin/users",
 *   userPath: "/",
 * });
 *
 * <ImpersonationProvider manager={manager} {...handoff}>
 *   {children}
 * </ImpersonationProvider>
 * ```
 */
export function useNextHandoff(opts: {
  adminPath: string;
  userPath: string;
}): {
  onStart: (targetDisplayName: string) => void;
  onStop: (reason: "manual" | "timeout" | "orphan" | "restore-failed") => void;
} {
  const router = useRouter();
  return {
    onStart: () => router.push(opts.userPath),
    onStop: () => router.push(opts.adminPath),
  };
}
