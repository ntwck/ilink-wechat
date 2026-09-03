import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { ClipboardSyncService } from "./service.js";

function createService(opts?: {
  accountId?: string;
  cfg?: ConstructorParameters<typeof ClipboardSyncService>[2];
}): { service: ClipboardSyncService; stateDir: string } {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "clipboard-sync-"));
  const service = new ClipboardSyncService(opts?.accountId ?? "acc-1", stateDir, {
    enabled: true,
    ...(opts?.cfg ?? {}),
  });
  return { service, stateDir };
}

describe("ClipboardSyncService", () => {
  it("applies newer versions and rejects stale writes", () => {
    const { service, stateDir } = createService();
    try {
      const a = service.handleSet({ clientId: "c1", text: "v1", version: 1, timestamp: 1000 });
      expect(a.applied).toBe(true);

      const stale = service.handleSet({
        clientId: "c2",
        text: "old",
        version: 1,
        timestamp: 900,
      });
      expect(stale.applied).toBe(false);
      expect(stale.reason).toBe("duplicate");

      const newer = service.handleSet({
        clientId: "c2",
        text: "v2",
        version: 2,
        timestamp: 1100,
      });
      expect(newer.applied).toBe(true);
      expect(newer.state.text).toBe("v2");
      expect(newer.state.version).toBe(2);

      const staleLowerVersion = service.handleSet({
        clientId: "c3",
        text: "v1-again",
        version: 1,
        timestamp: 9999,
      });
      expect(staleLowerVersion.applied).toBe(false);
      expect(staleLowerVersion.reason).toBe("stale");
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("replays incremental events excluding self-origin and supports ack cursor", () => {
    const { service, stateDir } = createService();
    try {
      service.handleSet({ clientId: "c1", text: "A", version: 1, timestamp: 1000 });
      service.handleSet({ clientId: "c2", text: "B", version: 2, timestamp: 2000 });
      service.handleSet({ clientId: "c1", text: "C", version: 3, timestamp: 3000 });

      const firstPull = service.handleGet({ clientId: "c2", cursor: 0 });
      expect(firstPull.events.map((e) => e.text)).toEqual(["A", "C"]);
      const lastCursor = firstPull.events[firstPull.events.length - 1]?.cursor ?? 0;

      const ack = service.handleAck({ clientId: "c2", cursor: lastCursor });
      expect(ack.ackedCursor).toBe(lastCursor);

      const secondPull = service.handleGet({ clientId: "c2" });
      expect(secondPull.events).toHaveLength(0);
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("persists state across service instances", () => {
    const { service, stateDir } = createService({ accountId: "acc-persist" });
    try {
      service.handleSet({ clientId: "writer", text: "persisted", version: 8, timestamp: 5000 });

      const restored = new ClipboardSyncService("acc-persist", stateDir, { enabled: true });
      const got = restored.handleGet({ clientId: "reader", cursor: 0 });
      expect(got.state?.text).toBe("persisted");
      expect(got.state?.version).toBe(8);
      expect(got.events).toHaveLength(1);
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });

  it("enforces client whitelist and text size", () => {
    const { service, stateDir } = createService({
      cfg: { allowedClientIds: ["allow-1"], maxTextBytes: 4 },
    });
    try {
      expect(() =>
        service.handleSet({ clientId: "deny", text: "ok", version: 1, timestamp: 1 }),
      ).toThrow("client not allowed");

      expect(() =>
        service.handleSet({ clientId: "allow-1", text: "12345", version: 1, timestamp: 1 }),
      ).toThrow("clipboard text too large");
    } finally {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  });
});
