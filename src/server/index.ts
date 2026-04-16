#!/usr/bin/env node
/**
 * ilink-wechat standalone server CLI.
 *
 * Usage:
 *   node --experimental-strip-types src/server/index.ts [command] [options]
 *
 * Commands:
 *   login    Scan QR code and save credentials (first-time setup).
 *   start    Start the long-poll monitor and forward messages to the
 *            configured external provider.  This is the default command.
 *
 * Options (environment variables):
 *   OPENCLAW_STATE_DIR   Override the state directory (default: ~/.openclaw)
 *   OPENCLAW_LOG_LEVEL   Log level: TRACE|DEBUG|INFO|WARN|ERROR  (default: INFO)
 *   ILINK_CONFIG         Path to config file
 *                        (default: ~/.openclaw/openclaw.json or ./ilink-wechat.json)
 *
 * Config file (JSON, two supported formats):
 *
 *   Option A — use the existing openclaw.json:
 *     { "channels": { "openclaw-weixin": { "provider": { "type": "rest", "endpoint": "..." } } } }
 *
 *   Option B — standalone ilink-wechat.json:
 *     { "provider": { "type": "rest", "endpoint": "..." }, "accountId": "optional" }
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeAccountId } from "openclaw/plugin-sdk/account-id";

import { loadWeixinAccount, listIndexedWeixinAccountIds, saveWeixinAccount, registerWeixinAccountId, clearStaleAccountsForUserId, DEFAULT_BASE_URL, CDN_BASE_URL } from "../auth/accounts.js";
import { clearContextTokensForAccount } from "../messaging/inbound.js";
import { startWeixinLoginWithQr, waitForWeixinLogin, DEFAULT_ILINK_BOT_TYPE } from "../auth/login-qr.js";
import { createReplyProvider } from "../providers/index.js";
import { runStandaloneMonitor } from "./standalone-monitor.js";
import { resolveStateDir } from "../storage/state-dir.js";
import { logger } from "../util/logger.js";

// ---------------------------------------------------------------------------
// Config loading
// ---------------------------------------------------------------------------

type ProviderConfig = {
  type: string;
  endpoint?: string;
  authToken?: string;
  authHeader?: string;
  timeoutMs?: number;
  fallbackMessage?: string;
  requestFormat?: string;
};

type StandaloneConfig = {
  /** Explicit account ID to use (optional when only one account is registered). */
  accountId?: string;
  /** Provider config. */
  provider: ProviderConfig;
};

function resolveConfigPath(): string {
  const env = process.env.ILINK_CONFIG?.trim();
  if (env) return env;

  // Look for standalone ilink-wechat.json in current dir first.
  const localPath = path.resolve("ilink-wechat.json");
  if (fs.existsSync(localPath)) return localPath;

  // Fall back to the shared openclaw.json.
  return path.join(resolveStateDir(), "openclaw.json");
}

function loadConfig(): StandaloneConfig {
  const cfgPath = resolveConfigPath();
  if (!fs.existsSync(cfgPath)) {
    printError(
      `Config file not found: ${cfgPath}\n` +
        `Create an ilink-wechat.json in the current directory, or set ILINK_CONFIG.\n` +
        `\nExample ilink-wechat.json:\n` +
        JSON.stringify(
          { provider: { type: "rest", endpoint: "http://localhost:8080/chat" } },
          null,
          2,
        ),
    );
    process.exit(1);
  }

  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
  } catch (err) {
    printError(`Failed to parse config file ${cfgPath}: ${String(err)}`);
    process.exit(1);
  }

  const obj = raw as Record<string, unknown>;

  // Support openclaw.json format: { channels: { "openclaw-weixin": { provider: {...} } } }
  if (obj.channels && typeof obj.channels === "object") {
    const channelSection = (obj.channels as Record<string, unknown>)["openclaw-weixin"] as Record<string, unknown> | undefined;
    if (channelSection?.provider) {
      return {
        accountId: typeof obj.accountId === "string" ? obj.accountId : undefined,
        provider: channelSection.provider as ProviderConfig,
      };
    }
  }

  // Support standalone format: { provider: {...}, accountId?: "..." }
  if (obj.provider && typeof obj.provider === "object") {
    return {
      accountId: typeof obj.accountId === "string" ? obj.accountId : undefined,
      provider: obj.provider as ProviderConfig,
    };
  }

  printError(
    `Config file ${cfgPath} has no provider configuration.\n` +
      `Add a "provider" field or "channels.openclaw-weixin.provider" section.`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Account resolution
// ---------------------------------------------------------------------------

function resolveAccountId(preferred?: string): { accountId: string; account: ReturnType<typeof loadWeixinAccount> } {
  const allIds = listIndexedWeixinAccountIds();

  if (allIds.length === 0) {
    printError(
      `No WeChat accounts found in ${resolveStateDir()}.\n` +
        `Run: node --experimental-strip-types src/server/index.ts login`,
    );
    process.exit(1);
  }

  if (preferred) {
    const normalized = preferred.includes("-") ? preferred : normalizeAccountId(preferred);
    const account = loadWeixinAccount(normalized);
    if (!account?.token) {
      printError(`Account "${normalized}" not found or has no token. Run \`login\` first.`);
      process.exit(1);
    }
    return { accountId: normalized, account };
  }

  if (allIds.length === 1) {
    const accountId = allIds[0];
    const account = loadWeixinAccount(accountId);
    if (!account?.token) {
      printError(`Account "${accountId}" has no token. Run \`login\` first.`);
      process.exit(1);
    }
    return { accountId, account };
  }

  printError(
    `Multiple accounts registered (${allIds.join(", ")}).\n` +
      `Specify which one to use: add "accountId" to your config file.`,
  );
  process.exit(1);
}

// ---------------------------------------------------------------------------
// login command
// ---------------------------------------------------------------------------

const QR_LOGIN_TIMEOUT_MS = 480_000; // 8 minutes

async function runLogin(): Promise<void> {
  print(`\n📱 Starting WeChat QR login...\n`);

  const startResult = await startWeixinLoginWithQr({
    apiBaseUrl: DEFAULT_BASE_URL,
    botType: DEFAULT_ILINK_BOT_TYPE,
    verbose: true,
  });

  if (!startResult.qrcodeUrl) {
    printError(`Failed to get QR code: ${startResult.message}`);
    process.exit(1);
  }

  print(`\n使用微信扫描以下二维码：\n`);

  try {
    const qrterm = await import("qrcode-terminal");
    await new Promise<void>((resolve) => {
      qrterm.default.generate(startResult.qrcodeUrl!, { small: true }, (qr: string) => {
        print(qr);
        resolve();
      });
    });
  } catch {
    print(`如果二维码未显示，请用浏览器打开：`);
  }
  print(startResult.qrcodeUrl!);

  print(`\n等待扫码确认...\n`);

  const waitResult = await waitForWeixinLogin({
    sessionKey: startResult.sessionKey,
    apiBaseUrl: DEFAULT_BASE_URL,
    timeoutMs: QR_LOGIN_TIMEOUT_MS,
    verbose: true,
    botType: DEFAULT_ILINK_BOT_TYPE,
  });

  if (waitResult.connected && waitResult.botToken && waitResult.accountId) {
    const normalizedId = normalizeAccountId(waitResult.accountId);
    saveWeixinAccount(normalizedId, {
      token: waitResult.botToken,
      baseUrl: waitResult.baseUrl ?? DEFAULT_BASE_URL,
      userId: waitResult.userId,
    });
    registerWeixinAccountId(normalizedId);
    if (waitResult.userId) {
      clearStaleAccountsForUserId(normalizedId, waitResult.userId, clearContextTokensForAccount);
    }
    print(`\n✅ 登录成功！accountId=${normalizedId}`);
    print(`\n下一步：运行以下命令启动机器人：`);
    print(`  node --experimental-strip-types src/server/index.ts start\n`);
  } else {
    printError(`登录失败：${waitResult.message}`);
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// start command
// ---------------------------------------------------------------------------

async function runStart(): Promise<void> {
  const cfg = loadConfig();

  // Validate provider config
  if (!cfg.provider.type || cfg.provider.type === "openclaw") {
    printError(
      `Standalone mode requires provider.type="rest" or "ws".\n` +
        `The "openclaw" provider requires the OpenClaw gateway and cannot be used in standalone mode.`,
    );
    process.exit(1);
  }

  const replyProvider = createReplyProvider(cfg.provider);
  if (!replyProvider) {
    printError(`Failed to create reply provider from config.`);
    process.exit(1);
  }

  const { accountId, account } = resolveAccountId(cfg.accountId);
  const baseUrl = account?.baseUrl?.trim() || DEFAULT_BASE_URL;
  const cdnBaseUrl = CDN_BASE_URL;
  const token = account?.token ?? "";

  if (!token) {
    printError(`No token found for account ${accountId}. Run \`login\` first.`);
    process.exit(1);
  }

  print(`\n🤖 ilink-wechat standalone server`);
  print(`   account : ${accountId}`);
  print(`   provider: ${replyProvider.type}`);
  print(`   baseUrl : ${baseUrl}`);
  print(`   logFile : ${logger.getLogFilePath()}`);
  print(`\nPress Ctrl+C to stop.\n`);

  const ac = new AbortController();
  process.on("SIGINT", () => {
    print(`\n[ilink-wechat] Shutting down...`);
    ac.abort();
  });
  process.on("SIGTERM", () => {
    ac.abort();
  });

  await runStandaloneMonitor({
    baseUrl,
    cdnBaseUrl,
    token,
    accountId,
    replyProvider,
    abortSignal: ac.signal,
    log: (msg) => print(msg),
    errLog: (msg) => printError(msg),
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function print(msg: string): void {
  process.stdout.write(`${msg}\n`);
}

function printError(msg: string): void {
  process.stderr.write(`\n❌ ${msg}\n`);
}

function printHelp(): void {
  print(`
ilink-wechat — Standalone WeChat bot server

Usage:
  node --experimental-strip-types src/server/index.ts <command>

Commands:
  login    Scan WeChat QR code and save credentials
  start    Start the long-poll server (default command)
  help     Show this help message

Environment variables:
  OPENCLAW_STATE_DIR   State directory  (default: ~/.openclaw)
  OPENCLAW_LOG_LEVEL   Log level: TRACE|DEBUG|INFO|WARN|ERROR
  ILINK_CONFIG         Path to config file

Config file (ilink-wechat.json or openclaw.json):
  {
    "provider": {
      "type": "rest",
      "endpoint": "http://localhost:8080/chat",
      "authToken": "optional-secret",
      "timeoutMs": 30000
    }
  }
`);
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const command = args[0] ?? "start";

switch (command) {
  case "login":
    await runLogin();
    break;
  case "start":
    await runStart();
    break;
  case "help":
  case "--help":
  case "-h":
    printHelp();
    break;
  default:
    printError(`Unknown command: ${command}. Run with --help for usage.`);
    process.exit(1);
}
