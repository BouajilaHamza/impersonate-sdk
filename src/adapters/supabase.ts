import type {
  ImpersonationAdapter,
  SessionSnapshot,
  ImpersonationResult,
} from "../core/types";

/**
 * Supabase client type.
 * We use a structural type instead of importing @supabase/supabase-js
 * so the adapter compiles even when the package isn't installed.
 */
interface SupabaseClient {
  auth: {
    getSession(): Promise<{
      data: {
        session: {
          access_token: string;
          refresh_token: string;
        } | null;
      };
    }>;
    setSession(params: {
      access_token: string;
      refresh_token: string;
    }): Promise<{ error: Error | null }>;
    verifyOtp(params: {
      token_hash: string;
      type: "magiclink";
    }): Promise<{ error: Error | null }>;
  };
  functions: {
    invoke(
      functionName: string,
      options: { body: Record<string, unknown> }
    ): Promise<{ data: any; error: Error | null }>;
  };
}

export interface SupabaseAdapterConfig {
  /** The Supabase client instance. */
  supabaseClient: SupabaseClient;
  /** Name of the edge function to invoke. Default: "impersonate-user". */
  functionName?: string;
}

/**
 * Supabase adapter for impersonation.
 *
 * Uses Supabase's magic link flow:
 * 1. Calls an edge function that generates a magic link token (no email sent)
 * 2. Verifies the OTP client-side to establish the target user's session
 * 3. Restores admin session by calling setSession with saved tokens
 */
export class SupabaseAdapter implements ImpersonationAdapter {
  private supabase: SupabaseClient;
  private functionName: string;

  constructor(config: SupabaseAdapterConfig) {
    this.supabase = config.supabaseClient;
    this.functionName = config.functionName ?? "impersonate-user";
  }

  async saveCurrentSession(): Promise<SessionSnapshot> {
    const {
      data: { session },
    } = await this.supabase.auth.getSession();

    if (!session) {
      throw new Error("No active session to save");
    }

    return {
      data: {
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      },
    };
  }

  async createImpersonatedSession(
    targetUserId: string
  ): Promise<ImpersonationResult> {
    // Call edge function to get magic link token
    const { data, error } = await this.supabase.functions.invoke(
      this.functionName,
      { body: { target_user_id: targetUserId } }
    );

    if (error || !data?.hashed_token) {
      throw new Error(
        data?.error || error?.message || "Failed to start impersonation"
      );
    }

    // Establish target user's session via OTP verification
    const { error: otpError } = await this.supabase.auth.verifyOtp({
      token_hash: data.hashed_token,
      type: "magiclink",
    });

    if (otpError) {
      throw new Error(otpError.message);
    }

    return {
      targetDisplayName: data.target_user_name ?? "Unknown User",
    };
  }

  async restoreSession(snapshot: SessionSnapshot): Promise<void> {
    const { access_token, refresh_token } = snapshot.data as {
      access_token: string;
      refresh_token: string;
    };

    const { error } = await this.supabase.auth.setSession({
      access_token,
      refresh_token,
    });

    if (error) {
      throw new Error(`Failed to restore admin session: ${error.message}`);
    }
  }
}
