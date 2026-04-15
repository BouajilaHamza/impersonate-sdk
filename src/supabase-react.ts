// Convenience entry point for the most common path: Supabase + React.
// One import gives you everything you need.
export {
  SupabaseAdapter,
  createSupabaseImpersonation,
} from "./adapters/supabase";
export type { SupabaseAdapterConfig } from "./adapters/supabase";

export {
  ImpersonationProvider,
  useImpersonation,
  ImpersonationBanner,
} from "./react";
export type {
  ImpersonationProviderProps,
  ImpersonationBannerProps,
} from "./react";

import { useImpersonation } from "./react";

interface SignOutCapableClient {
  auth: {
    signOut(): Promise<{ error: Error | null } | { error: null } | unknown>;
  };
}

/**
 * Returns a sign-out function that stops impersonation first if active,
 * restoring the admin session instead of signing the admin out.
 *
 * Must be called inside an `<ImpersonationProvider>`.
 *
 * @example
 * ```tsx
 * const signOut = useGuardedSignOut(supabase);
 * <button onClick={signOut}>Sign out</button>
 * ```
 */
export function useGuardedSignOut(
  supabase: SignOutCapableClient
): () => Promise<void> {
  const { isActive, stop } = useImpersonation();
  return async () => {
    if (isActive) {
      await stop();
      return;
    }
    await supabase.auth.signOut();
  };
}
