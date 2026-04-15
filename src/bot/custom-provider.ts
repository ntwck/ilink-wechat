/**
 * 自定义 Bot 服务客户端
 *
 * 支持任何兼容 OpenAI Chat Completions API 的服务（OpenAI、Azure OpenAI、Ollama、LocalAI 等）。
 * 每个 (accountId, userId) 对维护独立的对话历史，支持多轮对话。
 */

import { logger } from "../util/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** 自定义 Bot 服务配置（来自 openclaw.json channels.openclaw-weixin.bot.service）。 */
export type CustomBotServiceConfig = {
  /** 服务 base URL，例如 "https://api.openai.com" 或 "http://localhost:11434"。 */
  baseUrl: string;
  /** API 密钥，用于 Authorization: Bearer 头。 */
  apiKey?: string;
  /** 模型名称，默认 "gpt-3.5-turbo"。 */
  model?: string;
  /** 系统提示词（system prompt）。 */
  systemPrompt?: string;
  /** 保留的最大对话轮数（user+assistant 各算一条），默认 20。 */
  maxHistory?: number;
  /** HTTP 请求超时（毫秒），默认 60000。 */
  timeoutMs?: number;
};

type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

type ChatCompletionsResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

// ---------------------------------------------------------------------------
// In-memory conversation history
// ---------------------------------------------------------------------------

/** 按 "accountId:userId" 索引的对话历史。 */
const historyStore = new Map<string, ChatMessage[]>();

function historyKey(accountId: string, userId: string): string {
  return `${accountId}:${userId}`;
}

/** 清除特定用户的对话历史。 */
export function clearCustomBotHistory(accountId: string, userId: string): void {
  const key = historyKey(accountId, userId);
  historyStore.delete(key);
  logger.info(`custom bot: history cleared for accountId=${accountId} userId=${userId}`);
}

/** 清除某账号下所有用户的对话历史。 */
export function clearAllCustomBotHistoryForAccount(accountId: string): void {
  const prefix = `${accountId}:`;
  let count = 0;
  for (const key of [...historyStore.keys()]) {
    if (key.startsWith(prefix)) {
      historyStore.delete(key);
      count++;
    }
  }
  logger.info(`custom bot: cleared history for ${count} users in accountId=${accountId}`);
}

// ---------------------------------------------------------------------------
// HTTP client
// ---------------------------------------------------------------------------

/**
 * 调用自定义 Bot 服务（OpenAI-compatible /v1/chat/completions）。
 * 自动维护 per-user 对话历史。
 *
 * @throws 服务请求失败或返回空响应时抛出 Error。
 */
export async function callCustomBot(params: {
  userId: string;
  accountId: string;
  /** 用户发送的文本消息。 */
  text: string;
  config: CustomBotServiceConfig;
}): Promise<string> {
  const { userId, accountId, text, config } = params;
  const maxHistory = config.maxHistory ?? 20;
  const timeoutMs = config.timeoutMs ?? 60_000;
  const model = config.model ?? "gpt-3.5-turbo";

  const key = historyKey(accountId, userId);
  const history: ChatMessage[] = historyStore.get(key) ?? [];

  const userContent = text.trim() || "(empty)"; // send placeholder so the LLM has a non-empty turn
  history.push({ role: "user", content: userContent });

  // Build messages with optional system prompt
  const messages: ChatMessage[] = [];
  if (config.systemPrompt?.trim()) {
    messages.push({ role: "system", content: config.systemPrompt.trim() });
  }
  messages.push(...history);

  // Compose endpoint URL
  const base = config.baseUrl.replace(/\/$/, "");
  const url = `${base}/v1/chat/completions`;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (config.apiKey?.trim()) {
    headers["Authorization"] = `Bearer ${config.apiKey.trim()}`;
  }

  const body = JSON.stringify({ model, messages, stream: false });

  logger.debug(
    `custom bot: POST ${url} model=${model} historyLen=${history.length} timeoutMs=${timeoutMs}`,
  );

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let replyText: string;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);

    const rawText = await res.text();
    logger.debug(`custom bot: status=${res.status} replyLen=${rawText.length}`);

    if (!res.ok) {
      throw new Error(`custom bot service HTTP ${res.status}: ${rawText.slice(0, 300)}`);
    }

    const json = JSON.parse(rawText) as ChatCompletionsResponse;
    replyText = json.choices?.[0]?.message?.content?.trim() ?? "";
    if (!replyText) {
      throw new Error("custom bot service returned empty response");
    }
  } catch (err) {
    clearTimeout(timer);
    // Roll back the user message we added since we failed to get a reply
    history.pop();
    historyStore.set(key, history);
    throw err;
  }

  // Append assistant reply and trim history
  history.push({ role: "assistant", content: replyText });

  // maxHistory * 2 because each conversation turn has one user message and one assistant message.
  const maxMessages = maxHistory * 2;
  if (history.length > maxMessages) {
    history.splice(0, history.length - maxMessages);
  }
  historyStore.set(key, history);

  logger.info(
    `custom bot: reply OK userId=${userId} replyLen=${replyText.length} historyLen=${history.length}`,
  );
  return replyText;
}
