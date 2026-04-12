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
