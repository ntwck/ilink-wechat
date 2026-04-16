import { z } from "zod";

import { CDN_BASE_URL, DEFAULT_BASE_URL } from "../auth/accounts.js";

// ---------------------------------------------------------------------------
// Zod config schema
// ---------------------------------------------------------------------------

const weixinAccountSchema = z.object({
  name: z.string().optional(),
  enabled: z.boolean().optional(),
  baseUrl: z.string().default(DEFAULT_BASE_URL),
  cdnBaseUrl: z.string().default(CDN_BASE_URL),
  routeTag: z.number().optional(),
});

// ---------------------------------------------------------------------------
// Provider configuration
//
// Determines how the bot generates replies to inbound WeChat messages.
//
// provider.type = "openclaw" (default)
//   Route messages through the OpenClaw agent pipeline (LLM, tools, etc.).
//
// provider.type = "rest"
//   POST each inbound message to your own HTTP endpoint and send back the text reply.
//   See README.zh_CN.md for the full request/response protocol.
//
// provider.type = "ws"
//   Open a WebSocket connection per message, send a JSON frame, receive a reply frame.
//   See README.zh_CN.md for the frame protocol.
// ---------------------------------------------------------------------------

const baseExternalProviderSchema = z.object({
  /** URL of the external endpoint (required for "rest" and "ws"). */
  endpoint: z.string(),
  /**
   * HTTP header name used to carry the auth token (default: "Authorization").
   * Only used for type="rest".
   */
  authHeader: z.string().optional(),
  /** Auth token value sent in the header / WS handshake. */
  authToken: z.string().optional(),
  /** Per-request timeout in milliseconds (default: 30 000). */
  timeoutMs: z.number().int().positive().optional(),
  /**
   * Message sent to the user when the external API is unreachable or returns an error.
   * Defaults to "⚠️ 服务暂时不可用，请稍后再试。"
   */
  fallbackMessage: z.string().optional(),
});

const openclawProviderSchema = z.object({
  type: z.literal("openclaw"),
});

const restProviderSchema = baseExternalProviderSchema.extend({
  type: z.literal("rest"),
  /**
   * Request body format:
   *   - "simple" (default): { from, body, contextToken, accountId, mediaPath?, mediaType? }
   *   - "openai": OpenAI chat-completions format — the endpoint must be OpenAI-compatible.
   */
  requestFormat: z.enum(["simple", "openai"]).optional(),
  /**
   * Reply delivery mode:
   *   - "sync" (default): the bot waits for the HTTP response and sends it to WeChat.
   *   - "async": the bot fires the POST, receives an acknowledgement, and returns.
   *     The external server calls back later via the bot's callback endpoint.
   */
  mode: z.enum(["sync", "async"]).optional(),
  /**
   * Port for the async callback HTTP server (default: 8765).
   * Only used when mode="async".
   */
  callbackPort: z.number().int().positive().optional(),
  /**
   * URL path for the async callback endpoint (default: "/callback").
   * Only used when mode="async".
   */
  callbackPath: z.string().optional(),
  /**
   * Auth token the external server must send in the Authorization header
   * when calling the callback endpoint.
   * Only used when mode="async".
   */
  callbackAuthToken: z.string().optional(),
});

const wsProviderSchema = baseExternalProviderSchema.extend({
  type: z.literal("ws"),
});

const providerSchema = z.union([
  openclawProviderSchema,
  restProviderSchema,
  wsProviderSchema,
]);

/** Top-level weixin config schema (token is stored in credentials file, not config). */
export const WeixinConfigSchema = weixinAccountSchema.extend({
  accounts: z.record(z.string(), weixinAccountSchema).optional(),
  /** ISO 8601; bumped on each successful login to refresh gateway config from disk. */
  channelConfigUpdatedAt: z.string().optional(),
  /**
   * Reply-provider configuration.
   * Omit (or set type="openclaw") to use the default OpenClaw agent pipeline.
   * Set type="rest" or type="ws" to forward messages to your own bot backend.
   */
  provider: providerSchema.optional(),
});
