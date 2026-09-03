/**
 * Standalone callback HTTP server.
 *
 * Listens for POST requests from the external server and forwards the reply to
 * the WeChat user via sendMessageWeixin.
 *
 * Expected request format (POST <callbackPath>):
 *   Content-Type: application/json
 *   Authorization: <callbackAuthToken>   (optional, when configured)
 *
 *   {
 *     "requestId": "<id returned in the original POST to the external server>",
 *     "text": "Reply text to send to the user",
 *     "mediaUrl": "optional — same format as ExternalReplyResponse.mediaUrl"
 *   }
 *
 * Response:
 *   200 OK:   { "ok": true }
 *   400:      { "ok": false, "error": "..." }  — malformed body
 *   401:      { "ok": false, "error": "unauthorized" }
 *   404:      { "ok": false, "error": "unknown or expired requestId" }
 *   405:      { "ok": false, "error": "method not allowed" }
 *   500:      { "ok": false, "error": "..." }  — internal error
 *
 * Clipboard sync events (optional, same callback endpoint):
 *   { "eventType":"set","accountId":"...","clientId":"...","text":"...","version":1,"timestamp":123 }
 *   { "eventType":"get","accountId":"...","clientId":"...","cursor":12 }
 *   { "eventType":"ack","accountId":"...","clientId":"...","cursor":15 }
 */

import http from "node:http";

import {
  ClipboardSyncService,
  parseClipboardSyncConfig,
} from "../clipboard/service.js";
import { callbackRegistry } from "../providers/callback-registry.js";
import { sendMessageWeixin } from "../messaging/send.js";
import { logger } from "../util/logger.js";
import { truncate } from "../util/redact.js";

export type CallbackServerConfig = {
  /** Port to listen on (default: 8765). */
  port?: number;
  /** URL path to accept callbacks on (default: "/callback"). */
  path?: string;
  /**
   * When set, every request must include "Authorization: <callbackAuthToken>" header.
   * Requests without this header receive 401.
   */
  authToken?: string;
  /** Account scope for clipboard sync and request validation. */
  accountId?: string;
  /** State root dir, usually resolveStateDir(). */
  stateDir?: string;
  /** Clipboard sync runtime configuration. */
  clipboardSync?: unknown;
};

export type CallbackServerHandle = {
  close(): Promise<void>;
};

const DEFAULT_PORT = 8765;
const DEFAULT_PATH = "/callback";

/**
 * Start the callback HTTP server.  Returns a handle that can be used to shut it down.
 */
export function startCallbackServer(cfg: CallbackServerConfig = {}): CallbackServerHandle {
  const port = cfg.port ?? DEFAULT_PORT;
  const cbPath = cfg.path ?? DEFAULT_PATH;
  const authToken = cfg.authToken?.trim() || undefined;
  const clipboard = cfg.accountId && cfg.stateDir
    ? new ClipboardSyncService(
        cfg.accountId,
        cfg.stateDir,
        parseClipboardSyncConfig(cfg.clipboardSync),
      )
    : undefined;

  // Periodically clean up expired registry entries (every minute).
  const cleanupInterval = setInterval(() => callbackRegistry.cleanup(), 60_000);

  const server = http.createServer((req, res) => {
    const respond = (status: number, body: unknown): void => {
      const payload = JSON.stringify(body);
      res.writeHead(status, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(payload),
      });
      res.end(payload);
    };

    // Only accept POST on the configured path.
    if (req.method !== "POST") {
      respond(405, { ok: false, error: "method not allowed" });
      return;
    }
    if (req.url?.split("?")[0] !== cbPath) {
      respond(404, { ok: false, error: "not found" });
      return;
    }

    // Auth check.
    if (authToken) {
      const incoming = req.headers["authorization"]?.trim() ?? "";
      if (incoming !== authToken) {
        respond(401, { ok: false, error: "unauthorized" });
        return;
      }
      logger.debug(`[callback-server] auth OK`);
    }

    // Read body.
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as Record<string, unknown>;
      } catch {
        respond(400, { ok: false, error: "invalid JSON body" });
        return;
      }
      logger.debug(`[callback-server] body parsed: keys=[${Object.keys(body).join(",")}]`);

      const eventType = typeof body.eventType === "string" ? body.eventType.trim() : "";
      if (eventType === "set" || eventType === "get" || eventType === "ack") {
        if (!clipboard || !clipboard.isEnabled()) {
          respond(400, { ok: false, error: "clipboard sync disabled" });
          return;
        }
        const accountId = typeof body.accountId === "string" ? body.accountId.trim() : "";
        if (!accountId || accountId !== cfg.accountId) {
          respond(403, { ok: false, error: "account mismatch" });
          return;
        }
        const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
        try {
          if (eventType === "set") {
            const text = typeof body.text === "string" ? body.text : "";
            const version =
              typeof body.version === "number" ? body.version : undefined;
            const timestamp =
              typeof body.timestamp === "number" ? body.timestamp : undefined;
            const result = clipboard.handleSet({ clientId, text, version, timestamp });
            respond(200, result);
            logger.info(
              `[callback-server] clipboard set account=${accountId} client=${clientId} applied=${String(result.applied)} version=${result.state.version} text=${truncate(result.state.text, 40)}`,
            );
            return;
          }
          if (eventType === "get") {
            const cursor =
              typeof body.cursor === "number" ? body.cursor : undefined;
            const result = clipboard.handleGet({ clientId, cursor });
            respond(200, result);
            logger.debug(
              `[callback-server] clipboard get account=${accountId} client=${clientId} cursor=${result.cursor} events=${result.events.length}`,
            );
            return;
          }
          const cursor = typeof body.cursor === "number" ? body.cursor : NaN;
          if (!Number.isFinite(cursor)) {
            respond(400, { ok: false, error: "missing cursor" });
            return;
          }
          const result = clipboard.handleAck({ clientId, cursor });
          respond(200, result);
          logger.debug(
            `[callback-server] clipboard ack account=${accountId} client=${clientId} cursor=${result.ackedCursor}`,
          );
          return;
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          respond(400, { ok: false, error: msg });
          logger.warn(`[callback-server] clipboard ${eventType} rejected: ${msg}`);
          return;
        }
      }

      const requestId = typeof body.requestId === "string" ? body.requestId.trim() : "";
      if (!requestId) {
        respond(400, { ok: false, error: "missing requestId" });
        return;
      }

      const replyText = typeof body.text === "string" ? body.text.trim() : "";
      const mediaUrl = typeof body.mediaUrl === "string" ? body.mediaUrl.trim() : "";

      if (!replyText && !mediaUrl) {
        respond(400, { ok: false, error: "text or mediaUrl is required" });
        return;
      }

      logger.debug(
        `[callback-server] looking up requestId=${requestId} registry_size=${callbackRegistry.size()}`,
      );
      const ctx = callbackRegistry.get(requestId);
      if (!ctx) {
        logger.warn(`[callback-server] unknown or expired requestId=${requestId}`);
        respond(404, { ok: false, error: "unknown or expired requestId" });
        return;
      }

      logger.info(
        `[callback-server] delivering async reply: requestId=${requestId} to=${ctx.to} textLen=${replyText.length} mediaUrl=${mediaUrl || "none"}`,
      );

      // Fire-and-forget: send the reply to WeChat.
      Promise.resolve()
        .then(async () => {
          if (replyText) {
            await sendMessageWeixin({
              to: ctx.to,
              text: replyText,
              opts: {
                baseUrl: ctx.baseUrl,
                token: ctx.token,
                contextToken: ctx.contextToken,
              },
            });
          }
          // mediaUrl delivery is not yet supported in async mode (requires CDN upload).
          // A future enhancement can add it here.
          if (mediaUrl && !replyText) {
            logger.warn(
              `[callback-server] mediaUrl-only async replies are not yet supported (requestId=${requestId})`,
            );
          }
        })
        .catch((err: unknown) => {
          logger.error(`[callback-server] failed to send reply to=${ctx.to}: ${String(err)}`);
        });

      respond(200, { ok: true });
    });

    req.on("error", (err: Error) => {
      logger.error(`[callback-server] request error: ${String(err)}`);
    });
  });

  server.listen(port, () => {
    logger.info(`[callback-server] listening on port ${port} path=${cbPath}`);
    process.stdout.write(
      `   callback: http://0.0.0.0:${port}${cbPath}\n`,
    );
  });

  return {
    close(): Promise<void> {
      clearInterval(cleanupInterval);
      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
