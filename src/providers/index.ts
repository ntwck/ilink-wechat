/**
 * Provider factory — creates the appropriate ReplyProvider from channel config.
 *
 * Usage (in monitor.ts):
 *   const section = config.channels?.["openclaw-weixin"] as Record<string, unknown> | undefined;
 *   const replyProvider = createReplyProvider(section?.provider);
 *
 * When the provider type is "openclaw" or not set, returns undefined so that the
 * existing OpenClaw dispatch path is used unchanged.
 */

import { RestReplyProvider, WsReplyProvider } from "./external-api-provider.js";
import type { RestProviderConfig, WsProviderConfig } from "./external-api-provider.js";
import type { ReplyProvider } from "./types.js";

export type { ReplyProvider, ExternalReplyRequest, ExternalReplyResponse } from "./types.js";
export { RestReplyProvider, WsReplyProvider } from "./external-api-provider.js";
export type { RestProviderConfig, WsProviderConfig } from "./external-api-provider.js";

/**
 * Create a ReplyProvider from a raw config object (the `provider` section from channel config).
 *
 * Returns `undefined` when:
 *   - config is missing/null/not an object  → use OpenClaw dispatch (default behaviour)
 *   - config.type === "openclaw"            → use OpenClaw dispatch (explicit opt-in)
 *
 * Returns a RestReplyProvider when config.type === "rest".
 * Returns a WsReplyProvider  when config.type === "ws".
 */
export function createReplyProvider(cfg: unknown): ReplyProvider | undefined {
  if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return undefined;

  const c = cfg as Record<string, unknown>;
  const type = typeof c.type === "string" ? c.type : "openclaw";

  if (type === "openclaw" || !type) return undefined;

  if (type === "rest") {
    const endpoint = typeof c.endpoint === "string" ? c.endpoint.trim() : "";
    if (!endpoint) {
      throw new Error(
        `[provider] type="rest" requires a non-empty "endpoint" field in channels.openclaw-weixin.provider`,
      );
    }
    return new RestReplyProvider({
      type: "rest",
      endpoint,
      authHeader: typeof c.authHeader === "string" ? c.authHeader : undefined,
      authToken: typeof c.authToken === "string" ? c.authToken : undefined,
      timeoutMs: typeof c.timeoutMs === "number" ? c.timeoutMs : undefined,
      fallbackMessage: typeof c.fallbackMessage === "string" ? c.fallbackMessage : undefined,
      requestFormat:
        c.requestFormat === "openai" || c.requestFormat === "simple"
          ? c.requestFormat
          : undefined,
    } satisfies RestProviderConfig);
  }

  if (type === "ws") {
    const endpoint = typeof c.endpoint === "string" ? c.endpoint.trim() : "";
    if (!endpoint) {
      throw new Error(
        `[provider] type="ws" requires a non-empty "endpoint" field in channels.openclaw-weixin.provider`,
      );
    }
    return new WsReplyProvider({
      type: "ws",
      endpoint,
      authToken: typeof c.authToken === "string" ? c.authToken : undefined,
      timeoutMs: typeof c.timeoutMs === "number" ? c.timeoutMs : undefined,
      fallbackMessage: typeof c.fallbackMessage === "string" ? c.fallbackMessage : undefined,
    } satisfies WsProviderConfig);
  }

  throw new Error(
    `[provider] Unknown provider type "${type}". ` +
      `Valid values: "openclaw" (default), "rest", "ws".`,
  );
}
