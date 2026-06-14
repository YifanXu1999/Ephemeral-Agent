import { createServer, type Server } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  SandboxGatewayClient,
  decodeResponse,
  encodeRequest,
  isRetryableFault,
} from "../../src/sandbox/gateway-client.js";

describe("encodeRequest", () => {
  it("writes one compact-JSON line with op, sandbox_id, invocation_id and args", () => {
    const line = encodeRequest({
      op: "sandbox.file.read",
      sandbox_id: "sb-1",
      invocation_id: "inv-1",
      args: { path: "README.md", caller_id: "run-1" },
    });
    expect(line.endsWith("\n"), "line is newline-terminated").toBe(true);
    expect(line.includes("\n", 0), "exactly one trailing newline").toBe(true);
    expect(JSON.parse(line)).toEqual({
      op: "sandbox.file.read",
      sandbox_id: "sb-1",
      invocation_id: "inv-1",
      args: { path: "README.md", caller_id: "run-1" },
    });
  });

  it("mints a uuid4 hex invocation_id when absent", () => {
    const parsed = JSON.parse(
      encodeRequest({ op: "sandbox.acquire", sandbox_id: "sb-1", args: {} }),
    ) as { invocation_id: string };
    expect(parsed.invocation_id).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("decodeResponse", () => {
  it.each([
    { status: "ok", carries: "result" },
    { status: "running", carries: "result" },
  ])("parses an envelope $status carrying result", ({ status }) => {
    const res = decodeResponse(JSON.stringify({ status, result: { value: 1 } }));
    expect(res.status).toBe(status);
    if (res.status === "ok" || res.status === "running") {
      expect(res.result).toEqual({ value: 1 });
    }
  });

  it.each(["rejected", "error"])("parses an envelope %s carrying error", (status) => {
    const res = decodeResponse(
      JSON.stringify({ status, error: { kind: "occ_conflict", message: "boom" } }),
    );
    expect(res.status).toBe(status);
    if (res.status === "rejected" || res.status === "error") {
      expect(res.error).toEqual({ kind: "occ_conflict", message: "boom" });
    }
  });

  it("rejects an unknown top-level status", () => {
    expect(() => decodeResponse(JSON.stringify({ status: "weird" }))).toThrow();
  });
});

describe("isRetryableFault", () => {
  it.each([
    { kind: "sandbox_unavailable", retryable: true },
    { kind: "uncertain_outcome", retryable: false },
    { kind: "occ_conflict", retryable: false },
  ])("classifies $kind as retryable=$retryable", ({ kind, retryable }) => {
    expect(isRetryableFault(kind)).toBe(retryable);
  });
});

describe("SandboxGatewayClient over a Unix socket", () => {
  let server: Server | undefined;
  const sockPath = (): string => join(mkdtempSync(join(tmpdir(), "eos-gw-")), "gw.sock");

  afterEach(() => {
    server?.close();
    server = undefined;
  });

  function serveOne(path: string, onLine: (line: string) => string): Promise<void> {
    return new Promise((ready) => {
      server = createServer((sock) => {
        let buf = "";
        sock.setEncoding("utf8");
        sock.on("data", (chunk: string) => {
          buf += chunk;
          if (buf.includes("\n")) {
            sock.end(onLine(buf.trim()) + "\n");
          }
        });
      });
      server.listen(path, ready);
    });
  }

  it("round-trips one request and parses the ok envelope", async () => {
    const path = sockPath();
    let seen = "";
    await serveOne(path, (line) => {
      seen = line;
      return JSON.stringify({ status: "ok", result: { content: "hi" } });
    });
    const client = new SandboxGatewayClient(path);
    const res = await client.call({
      op: "sandbox.file.read",
      sandbox_id: "sb-1",
      args: { path: "a.txt", caller_id: "run-1" },
    });
    expect(JSON.parse(seen)).toMatchObject({ op: "sandbox.file.read", sandbox_id: "sb-1" });
    expect(res.status).toBe("ok");
  });

  it("destroys the socket and rejects on abort before completion", async () => {
    const path = sockPath();
    // Server that never replies, forcing the abort path.
    server = createServer(() => undefined);
    await new Promise<void>((ready) => server?.listen(path, ready));
    const controller = new AbortController();
    const client = new SandboxGatewayClient(path);
    const pending = client.call(
      { op: "sandbox.command.exec", sandbox_id: "sb-1", args: { cmd: "sleep 10", caller_id: "r" } },
      { signal: controller.signal },
    );
    controller.abort();
    await expect(pending).rejects.toThrow(/aborted/);
  });
});
