import fs from "node:fs";
import path from "node:path";

import { truncate } from "../util/redact.js";
import { logger } from "../util/logger.js";

export type ClipboardSyncType = "text" | "media";

export type ClipboardSyncConfig = {
  enabled?: boolean;
  allowedClientIds?: string[];
  syncTypes?: ClipboardSyncType[];
  maxTextBytes?: number;
  maxEventLogEntries?: number;
};

export type ClipboardState = {
  valueType: "text";
  text: string;
  version: number;
  updatedAt: number;
  sourceClientId: string;
};

export type ClipboardEvent = ClipboardState & {
  cursor: number;
};

type ClipboardEventStore = {
  nextCursor: number;
  events: ClipboardEvent[];
};

type ClipboardClientState = {
  lastAckCursor: number;
  lastSeenAt: number;
};

type ClipboardClientStore = Record<string, ClipboardClientState>;

const DEFAULT_MAX_TEXT_BYTES = 64 * 1024;
const DEFAULT_MAX_LOG_ENTRIES = 5000;

function readJsonFile<T>(filePath: string): T | undefined {
  try {
    if (!fs.existsSync(filePath)) return undefined;
    return JSON.parse(fs.readFileSync(filePath, "utf-8")) as T;
  } catch {
    return undefined;
  }
}

function writeJsonFile(filePath: string, value: unknown): void {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf-8");
}

export class ClipboardSyncService {
  private readonly enabled: boolean;
  private readonly allowedClientIds?: Set<string>;
  private readonly allowText: boolean;
  private readonly maxTextBytes: number;
  private readonly maxEventLogEntries: number;
  private readonly stateFilePath: string;
  private readonly eventFilePath: string;
  private readonly clientsFilePath: string;

  constructor(
    private readonly accountId: string,
    stateDir: string,
    cfg: ClipboardSyncConfig | undefined,
  ) {
    this.enabled = cfg?.enabled === true;
    this.allowedClientIds = cfg?.allowedClientIds?.length
      ? new Set(cfg.allowedClientIds.map((x) => x.trim()).filter(Boolean))
      : undefined;
    const syncTypes = cfg?.syncTypes?.length ? cfg.syncTypes : ["text"];
    this.allowText = syncTypes.includes("text");
    this.maxTextBytes = Math.max(1, cfg?.maxTextBytes ?? DEFAULT_MAX_TEXT_BYTES);
    this.maxEventLogEntries = Math.max(1, cfg?.maxEventLogEntries ?? DEFAULT_MAX_LOG_ENTRIES);

    const accountsDir = path.join(stateDir, "openclaw-weixin", "accounts");
    this.stateFilePath = path.join(accountsDir, `${accountId}.clipboard.json`);
    this.eventFilePath = path.join(accountsDir, `${accountId}.clipboard-events.json`);
    this.clientsFilePath = path.join(accountsDir, `${accountId}.clipboard-clients.json`);
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  private assertEnabled(): void {
    if (!this.enabled) {
      throw new Error("clipboard sync disabled");
    }
  }

  private validateClient(clientId: string): void {
    if (!clientId.trim()) {
      throw new Error("clientId is required");
    }
    if (this.allowedClientIds && !this.allowedClientIds.has(clientId)) {
      throw new Error("client not allowed");
    }
  }

  private loadState(): ClipboardState | undefined {
    return readJsonFile<ClipboardState>(this.stateFilePath);
  }

  private saveState(state: ClipboardState): void {
    writeJsonFile(this.stateFilePath, state);
  }

  private loadEvents(): ClipboardEventStore {
    const parsed = readJsonFile<ClipboardEventStore>(this.eventFilePath);
    if (!parsed || !Array.isArray(parsed.events) || typeof parsed.nextCursor !== "number") {
      return { nextCursor: 1, events: [] };
    }
    return parsed;
  }

  private saveEvents(store: ClipboardEventStore): void {
    writeJsonFile(this.eventFilePath, store);
  }

  private loadClients(): ClipboardClientStore {
    const parsed = readJsonFile<ClipboardClientStore>(this.clientsFilePath);
    return parsed && typeof parsed === "object" ? parsed : {};
  }

  private saveClients(store: ClipboardClientStore): void {
    writeJsonFile(this.clientsFilePath, store);
  }

  private touchClient(clientId: string, ackCursor?: number): void {
    const clients = this.loadClients();
    const prev = clients[clientId]?.lastAckCursor ?? 0;
    clients[clientId] = {
      lastAckCursor: ackCursor == null ? prev : Math.max(prev, ackCursor),
      lastSeenAt: Date.now(),
    };
    this.saveClients(clients);
  }

  private appendEvent(state: ClipboardState): ClipboardEvent {
    const store = this.loadEvents();
    const event: ClipboardEvent = {
      cursor: store.nextCursor,
      ...state,
    };
    const events = [...store.events, event];
    const trimmed =
      events.length > this.maxEventLogEntries
        ? events.slice(events.length - this.maxEventLogEntries)
        : events;
    const nextCursor = event.cursor + 1;
    this.saveEvents({ nextCursor, events: trimmed });
    return event;
  }

  handleSet(params: {
    clientId: string;
    text: string;
    version?: number;
    timestamp?: number;
  }): {
    ok: true;
    applied: boolean;
    reason?: "duplicate" | "stale";
    state: ClipboardState;
    event?: ClipboardEvent;
  } {
    this.assertEnabled();
    if (!this.allowText) throw new Error("text sync is disabled");
    this.validateClient(params.clientId);

    const text = String(params.text ?? "");
    const textBytes = Buffer.byteLength(text, "utf-8");
    if (textBytes > this.maxTextBytes) {
      throw new Error(`clipboard text too large (${textBytes} > ${this.maxTextBytes})`);
    }

    const now = Date.now();
    const current = this.loadState();
    const incomingVersion = Number.isFinite(params.version)
      ? Math.max(1, Math.floor(params.version!))
      : (current?.version ?? 0) + 1;
    const incomingTimestamp = Number.isFinite(params.timestamp)
      ? Math.max(0, Math.floor(params.timestamp!))
      : now;

    const incomingState: ClipboardState = {
      valueType: "text",
      text,
      version: incomingVersion,
      updatedAt: incomingTimestamp,
      sourceClientId: params.clientId,
    };

    if (current) {
      if (incomingState.version < current.version) {
        this.touchClient(params.clientId);
        return { ok: true, applied: false, reason: "stale", state: current };
      }
      if (
        incomingState.version === current.version &&
        incomingState.updatedAt <= current.updatedAt
      ) {
        this.touchClient(params.clientId);
        return { ok: true, applied: false, reason: "duplicate", state: current };
      }
    }

    this.saveState(incomingState);
    const event = this.appendEvent(incomingState);
    this.touchClient(params.clientId);

    logger.info(
      `[clipboard] set applied account=${this.accountId} client=${params.clientId} version=${incomingState.version} text=${truncate(incomingState.text, 40)}`,
    );

    return { ok: true, applied: true, state: incomingState, event };
  }

  handleGet(params: {
    clientId: string;
    cursor?: number;
  }): {
    ok: true;
    state?: ClipboardState;
    events: ClipboardEvent[];
    nextCursor: number;
    cursor: number;
  } {
    this.assertEnabled();
    this.validateClient(params.clientId);

    const clients = this.loadClients();
    const storedCursor = clients[params.clientId]?.lastAckCursor ?? 0;
    const cursor =
      Number.isFinite(params.cursor) && params.cursor! >= 0
        ? Math.floor(params.cursor!)
        : storedCursor;

    const store = this.loadEvents();
    const events = store.events.filter((e) => e.cursor > cursor && e.sourceClientId !== params.clientId);

    this.touchClient(params.clientId);

    return {
      ok: true,
      state: this.loadState(),
      events,
      nextCursor: store.nextCursor,
      cursor,
    };
  }

  handleAck(params: {
    clientId: string;
    cursor: number;
  }): {
    ok: true;
    ackedCursor: number;
  } {
    this.assertEnabled();
    this.validateClient(params.clientId);

    const store = this.loadEvents();
    const boundedCursor = Math.max(0, Math.min(Math.floor(params.cursor), store.nextCursor - 1));
    this.touchClient(params.clientId, boundedCursor);

    return { ok: true, ackedCursor: boundedCursor };
  }
}

export function parseClipboardSyncConfig(raw: unknown): ClipboardSyncConfig | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const x = raw as Record<string, unknown>;
  return {
    enabled: x.enabled === true,
    allowedClientIds: Array.isArray(x.allowedClientIds)
      ? x.allowedClientIds.filter((v): v is string => typeof v === "string")
      : undefined,
    syncTypes: Array.isArray(x.syncTypes)
      ? x.syncTypes.filter((v): v is ClipboardSyncType => v === "text" || v === "media")
      : undefined,
    maxTextBytes: typeof x.maxTextBytes === "number" ? x.maxTextBytes : undefined,
    maxEventLogEntries:
      typeof x.maxEventLogEntries === "number" ? x.maxEventLogEntries : undefined,
  };
}
