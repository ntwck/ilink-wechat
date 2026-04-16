/**
 * In-memory registry of pending async callbacks.
 *
 * When the REST provider operates in async mode it POSTs the inbound message to the
 * external server and immediately returns a `pendingCallbackId`.  The caller then
 * registers the WeChat send-context here so that the callback server can look it up
 * when the external server eventually calls back with the reply.
 *
 * Entries expire after `ENTRY_TTL_MS` to avoid unbounded memory growth when the
 * external server never calls back.
 */

/** The context needed to send a WeChat reply once the async callback arrives. */
export type PendingCallbackContext = {
  /** WeChat recipient user ID (the original sender). */
  to: string;
  /** Bot API base URL. */
  baseUrl: string;
  /** Bot API auth token. */
  token: string;
  /** WeChat conversation context token — must be echoed in sendMessage. */
  contextToken?: string;
  /** Bot account ID (for logging). */
  accountId: string;
  /** Monotonic expiry timestamp (Date.now() + TTL). */
  expiresAt: number;
};

/**
 * Entries are kept for 1 hour then silently dropped.
 * WeChat's customer-service context token is valid for 24 h, but a 1-hour window
 * is a pragmatic balance: it covers multi-turn async conversations while bounding
 * memory usage and aligning with typical session lengths.
 */
const ENTRY_TTL_MS = 60 * 60 * 1_000;

class CallbackRegistry {
  private readonly pending = new Map<string, PendingCallbackContext>();

  /** Register a pending callback context keyed by requestId. */
  register(requestId: string, ctx: Omit<PendingCallbackContext, "expiresAt">): void {
    this.pending.set(requestId, { ...ctx, expiresAt: Date.now() + ENTRY_TTL_MS });
  }

  /** Retrieve the context for a given requestId WITHOUT removing it, so the same
   *  requestId can be reused across multiple callbacks within the TTL window.
   *  Returns undefined if not found or expired. */
  get(requestId: string): PendingCallbackContext | undefined {
    const entry = this.pending.get(requestId);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.pending.delete(requestId);
      return undefined;
    }
    return entry;
  }

  /** Remove a specific entry by requestId (e.g. when an async POST fails before any callback). */
  remove(requestId: string): void {
    this.pending.delete(requestId);
  }

  /** Remove all expired entries (called periodically by the callback server). */
  cleanup(): void {
    const now = Date.now();
    for (const [id, entry] of this.pending) {
      if (now > entry.expiresAt) this.pending.delete(id);
    }
  }

  /** Number of currently registered pending callbacks (for diagnostics). */
  size(): number {
    return this.pending.size;
  }
}

/** Singleton registry shared between the REST provider and the callback server. */
export const callbackRegistry = new CallbackRegistry();
