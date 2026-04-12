import { ImpersonationManager } from "../core/ImpersonationManager";
import type {
  ImpersonationAdapter,
  ImpersonationConfig,
  SessionSnapshot,
  ImpersonationResult,
} from "../core/types";

export interface GenericHTTPAdapterConfig {
  /** URL to POST to when starting impersonation. */
  startUrl: string;

  /**
   * Establish the impersonated session client-side using the server response.
   * For Django: set a session cookie. For JWT: store the token.
   */
  signIn: (responseData: any) => Promise<void>;

  /**
   * Capture the current session data for later restoration.
   * Default: captures document.cookie (works for cookie-based auth).
   */
  getSession?: () => Promise<unknown>;

  /**
   * Restore a previously saved session.
   * Default: no-op (cookie-based auth persists naturally via the browser).
   */
  restoreSession?: (data: unknown) => Promise<void>;

  /** Optional: sign out the impersonated session before restoring. */
  signOut?: () => Promise<void>;

  /** Optional: return custom headers (e.g., CSRF token, auth bearer). */
  getHeaders?: () => Promise<Record<string, string>>;

  /** Optional: build a custom request body. Default: { target_user_id }. */
  buildBody?: (targetUserId: string) => unknown;

  /**
   * Optional: extract the display name from the server response.
   * Default: reads `response.target_user_name` or `response.display_name`.
   */
  getDisplayName?: (responseData: any) => string;
}

/**
 * Generic HTTP adapter for any REST backend.
 *
 * This is the "escape hatch" adapter. Works with Django, Flask, Express,
 * or any backend that has a POST endpoint for generating impersonation sessions.
 *
 * @example Django
 * ```ts
 * new GenericHTTPAdapter({
 *   startUrl: '/api/admin/impersonate/',
 *   getHeaders: async () => ({ 'X-CSRFToken': getCsrfToken() }),
 *   signIn: async (data) => {
 *     document.cookie = `sessionid=${data.session_id}; path=/`;
 *     location.reload();
 *   },
 *   getSession: async () => ({ sessionId: getCookie('sessionid') }),
 *   restoreSession: async (data) => {
 *     document.cookie = `sessionid=${data.sessionId}; path=/`;
 *     location.reload();
 *   },
 * })
 * ```
 */
export class GenericHTTPAdapter implements ImpersonationAdapter {
  constructor(private config: GenericHTTPAdapterConfig) {}

  async saveCurrentSession(): Promise<SessionSnapshot> {
    if (this.config.getSession) {
      const data = await this.config.getSession();
      return { data };
    }
    // Default: capture document.cookie for cookie-based auth
    return { data: typeof document !== "undefined" ? document.cookie : "" };
  }

  async createImpersonatedSession(
    targetUserId: string
  ): Promise<ImpersonationResult> {
    // Build headers
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (this.config.getHeaders) {
      Object.assign(headers, await this.config.getHeaders());
    }

    // Build body
    const body = this.config.buildBody
      ? this.config.buildBody(targetUserId)
      : { target_user_id: targetUserId };

    // Make the request
    const response = await fetch(this.config.startUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      credentials: "include", // Send cookies for session-based auth
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => null);
      throw new Error(
        errorData?.error ||
          errorData?.message ||
          `Impersonation request failed: ${response.status}`
      );
    }

    const responseData = await response.json();

    // Establish the session client-side
    await this.config.signIn(responseData);

    // Extract display name
    const displayName = this.config.getDisplayName
      ? this.config.getDisplayName(responseData)
      : responseData.target_user_name ||
        responseData.display_name ||
        "Unknown User";

    return { targetDisplayName: displayName };
  }

  async restoreSession(snapshot: SessionSnapshot): Promise<void> {
    if (this.config.restoreSession) {
      await this.config.restoreSession(snapshot.data);
    }
    // Default: no-op for cookie-based auth (browser manages cookies)
  }

  async destroyImpersonatedSession(): Promise<void> {
    if (this.config.signOut) {
      await this.config.signOut();
    }
  }
}

/**
 * Create an ImpersonationManager with a GenericHTTPAdapter in one call.
 *
 * @example
 * ```ts
 * const manager = createGenericImpersonation({
 *   startUrl: '/api/admin/impersonate/',
 *   signIn: async (data) => { document.cookie = `token=${data.token}; path=/`; },
 *   durationMinutes: 15,
 * });
 * ```
 */
export function createGenericImpersonation(
  config: GenericHTTPAdapterConfig & Omit<ImpersonationConfig, "adapter">
): ImpersonationManager {
  const {
    startUrl, signIn, getSession, restoreSession, signOut,
    getHeaders, buildBody, getDisplayName,
    ...managerConfig
  } = config;

  const adapter = new GenericHTTPAdapter({
    startUrl, signIn, getSession, restoreSession, signOut,
    getHeaders, buildBody, getDisplayName,
  });

  return new ImpersonationManager({ adapter, ...managerConfig });
}
