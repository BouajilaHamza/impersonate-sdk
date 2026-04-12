/**
 * Express middleware reference implementation for impersonation.
 *
 * This is a TEMPLATE — adapt it to your auth system.
 * It demonstrates the server-side contract that the GenericHTTPAdapter expects:
 *   POST /api/admin/impersonate
 *   Body: { target_user_id: string }
 *   Response: { session_id: string, target_user_name: string }
 *
 * Your implementation must:
 * 1. Verify the caller is an admin
 * 2. Prevent self-impersonation
 * 3. Create a session for the target user
 * 4. Return session data + display name
 */

import type { Request, Response, NextFunction } from "express";

// Replace with your actual auth/session logic
interface User {
  id: string;
  role: string;
  name: string;
}

/** Middleware: ensure caller is authenticated and is an admin. */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const user = (req as any).user as User | undefined;

  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  if (user.role !== "admin") {
    return res.status(403).json({ error: "Forbidden: admin access required" });
  }

  next();
}

/**
 * Handler: create an impersonation session.
 *
 * Adapt the session creation logic to your auth system:
 * - Session-based (express-session): create a new session for target user
 * - JWT-based: generate a token with the target user's claims
 * - Cookie-based: set a new session cookie
 */
export async function handleImpersonate(req: Request, res: Response) {
  const caller = (req as any).user as User;
  const { target_user_id } = req.body;

  if (!target_user_id) {
    return res.status(400).json({ error: "Missing target_user_id" });
  }

  if (target_user_id === caller.id) {
    return res.status(400).json({ error: "Cannot impersonate yourself" });
  }

  try {
    // TODO: Replace with your actual user lookup
    // const targetUser = await db.users.findById(target_user_id);
    const targetUser: User | null = null; // placeholder

    if (!targetUser) {
      return res.status(404).json({ error: "Target user not found" });
    }

    // TODO: Replace with your actual session creation logic
    // Example for express-session:
    //   req.session.impersonating = true;
    //   req.session.originalUserId = caller.id;
    //   req.session.userId = target_user_id;
    //   const sessionId = req.sessionID;

    // Example for JWT:
    //   const token = jwt.sign({ sub: target_user_id, imp: caller.id }, SECRET);

    const sessionId = "TODO_GENERATE_SESSION";

    return res.json({
      session_id: sessionId,
      target_user_name: targetUser.name,
    });
  } catch (err) {
    console.error("Impersonation error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
}

/**
 * Register routes:
 *
 * ```ts
 * import { requireAdmin, handleImpersonate } from './impersonate';
 *
 * app.post('/api/admin/impersonate', requireAdmin, handleImpersonate);
 * ```
 */
