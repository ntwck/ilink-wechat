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
// Custom bot service schema
// ---------------------------------------------------------------------------

/**
 * 自定义 Bot 服务配置（OpenAI-compatible Chat Completions API）。
 * 当 bot.provider 为 "custom" 时生效。
 */
const botServiceSchema = z.object({
  /** 服务 base URL，例如 "https://api.openai.com" 或 "http://localhost:11434"。 */
  baseUrl: z.string(),
  /** API 密钥（放在 Authorization: Bearer 头）。 */
  apiKey: z.string().optional(),
  /** HTTP 超时（毫秒），默认 60000。 */
  timeoutMs: z.number().int().positive().optional(),
  /** 模型名称，默认 "gpt-3.5-turbo"。 */
  model: z.string().optional(),
  /** 系统提示词（system prompt）。 */
  systemPrompt: z.string().optional(),
  /** 保留的最大对话轮数（user+assistant 各算一条），默认 20。 */
  maxHistory: z.number().int().positive().optional(),
});

/**
 * Bot 回复引擎配置。
 *   - "openclaw"（默认）：使用 OpenClaw 内置的 LLM 路由。
 *   - "custom"：调用用户自定义的 OpenAI-compatible 服务，不再依赖 OpenClaw。
 */
const botSchema = z.object({
  provider: z.enum(["openclaw", "custom"]).default("openclaw"),
  service: botServiceSchema.optional(),
});

// Export type for use in process-message
export type BotSchema = z.infer<typeof botSchema>;
export type BotServiceSchema = z.infer<typeof botServiceSchema>;

/** Top-level weixin config schema (token is stored in credentials file, not config). */
export const WeixinConfigSchema = weixinAccountSchema.extend({
  accounts: z.record(z.string(), weixinAccountSchema).optional(),
  /** ISO 8601; bumped on each successful login to refresh gateway config from disk. */
  channelConfigUpdatedAt: z.string().optional(),
  /** Bot 回复引擎配置（默认使用 openclaw）。 */
  bot: botSchema.optional(),
});
