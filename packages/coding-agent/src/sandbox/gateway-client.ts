import { createConnection, type Socket } from "node:net";
import { randomUUID } from "node:crypto";

import type { JsonValue } from "@ephai/agent-core";
import { z } from "zod";

/** Local JSON schema for the envelope payload (the wire is pure JSON). */
const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

/**
 * The Unix-domain-socket client for the eos-sandbox gateway (BR-1/BR-6). One
 * request per connection: write one compact-JSON line, read to the single
 * `\n`/EOF, parse, close. The gateway is one-request-per-connection, so a fresh
 * socket is opened per call (no pooling).
 *
 * Per-op *result* Zod schemas live at this edge, never in `src/contracts`: the
 * envelope is a transport contract owned by the gateway boundary.
 */

const DEFAULT_SOCKET_PATH = "/tmp/sandbox-gateway.sock";
/** Bounded connect timeout; the gateway may not yet be listening. */
const CONNECT_TIMEOUT_MS = 5_000;
/** Client-side `ECONNREFUSED` backoff (gateway not up yet), bounded. */
const CONNECT_RETRY_DELAYS_MS = [100, 250, 500] as const;

/** The wire request line. `sandbox_id` is required by the daemon op path. */
export interface GatewayRequest {
  op: string;
  sandbox_id: string;
  /** Defaults to a fresh uuid4 hex when absent; usually `ctx.toolUseId`. */
  invocation_id?: string;
  args: Record<string, unknown>;
}

/**
 * The top-level envelope status is the *transport* outcome — branch it FIRST,
 * then `result.status` for command/file ops (see how-to-connect §2). `ok`,
 * `running`, `cancelled`, `timed_out` carry `result`; `rejected`, `error` carry
 * `error` (rejected may also carry a partial `result`).
 */
const GatewayError = z.object({
  kind: z.string(),
  message: z.string(),
  details: z.unknown().optional(),
});
export type GatewayError = z.infer<typeof GatewayError>;

const ResultCarrying = z.object({
  status: z.enum(["ok", "running", "cancelled", "timed_out"]),
  result: JsonValueSchema.optional(),
  meta: z.unknown().optional(),
});
const ErrorCarrying = z.object({
  status: z.enum(["rejected", "error"]),
  error: GatewayError,
  result: JsonValueSchema.optional(),
  meta: z.unknown().optional(),
});

export const GatewayResponse = z.discriminatedUnion("status", [
  ResultCarrying,
  ErrorCarrying,
]);
export type GatewayResponse = z.infer<typeof GatewayResponse>;

/** Encode a request to the single wire line (pure; unit-testable). */
export function encodeRequest(req: GatewayRequest): string {
  const invocation_id = req.invocation_id ?? randomUUID().replace(/-/g, "");
  return (
    JSON.stringify({
      op: req.op,
      sandbox_id: req.sandbox_id,
      invocation_id,
      args: req.args,
    }) + "\n"
  );
}

/** Decode one response line into the validated envelope (pure; unit-testable). */
export function decodeResponse(raw: string): GatewayResponse {
  return GatewayResponse.parse(JSON.parse(raw));
}

/** Faults the client classifies for the caller (BR-6). */
export function isRetryableFault(kind: string): boolean {
  // `sandbox_unavailable` = recovery exhausted, safe to retry. `uncertain_outcome`
  // is a mutation whose delivery became ambiguous — terminal, never retried.
  return kind === "sandbox_unavailable";
}

interface CallOptions {
  invocationId?: string;
  signal?: AbortSignal;
}

export class SandboxGatewayClient {
  readonly #socketPath: string;

  constructor(socketPath: string = DEFAULT_SOCKET_PATH) {
    this.#socketPath = socketPath;
  }

  /** Acquire a sandbox; `sandbox.acquire` takes no `sandbox_id` and empty args. */
  async acquire(opts?: CallOptions): Promise<{ sandbox_id: string }> {
    const res = await this.#callNoSandbox("sandbox.acquire", {}, opts);
    return AcquireResult.parse(resultOf(res));
  }

  /** Release a sandbox; `sandbox.release` carries `sandbox_id` top-level. */
  async release(sandboxId: string, opts?: CallOptions): Promise<void> {
    await this.call({ op: "sandbox.release", sandbox_id: sandboxId, args: {} }, opts);
  }

  /**
   * One request/response over a fresh connection. Retries only `ECONNREFUSED`
   * (gateway not yet up); a connected-then-failed call is not retried.
   */
  call(req: GatewayRequest, opts?: CallOptions): Promise<GatewayResponse> {
    const line = encodeRequest({ ...req, invocation_id: opts?.invocationId ?? req.invocation_id });
    return this.#withRetry(line, opts?.signal);
  }

  #callNoSandbox(
    op: string,
    args: Record<string, unknown>,
    opts?: CallOptions,
  ): Promise<GatewayResponse> {
    // `acquire`/`list` omit `sandbox_id` entirely (the host strips it anyway).
    const line =
      JSON.stringify({
        op,
        invocation_id: opts?.invocationId ?? randomUUID().replace(/-/g, ""),
        args,
      }) + "\n";
    return this.#withRetry(line, opts?.signal);
  }

  async #withRetry(line: string, signal?: AbortSignal): Promise<GatewayResponse> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= CONNECT_RETRY_DELAYS_MS.length; attempt++) {
      try {
        return await this.#once(line, signal);
      } catch (error) {
        if (!isConnectionRefused(error) || attempt === CONNECT_RETRY_DELAYS_MS.length) {
          lastError = error;
          break;
        }
        await delay(CONNECT_RETRY_DELAYS_MS[attempt]);
      }
    }
    throw lastError;
  }

  #once(line: string, signal?: AbortSignal): Promise<GatewayResponse> {
    return new Promise<GatewayResponse>((resolve, reject) => {
      if (signal?.aborted) {
        reject(new Error("aborted"));
        return;
      }
      const sock: Socket = createConnection({ path: this.#socketPath });
      let buf = "";
      let settled = false;
      const finish = (fn: () => void): void => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        clearTimeout(timer);
        fn();
      };
      // Destroy BEFORE reject so a pending read terminates (BR-6).
      const onAbort = (): void => {
        sock.destroy();
        finish(() => { reject(new Error("aborted")); });
      };
      const timer = setTimeout(() => {
        sock.destroy();
        finish(() => { reject(new Error("gateway connect timeout")); });
      }, CONNECT_TIMEOUT_MS);

      signal?.addEventListener("abort", onAbort, { once: true });
      sock.setEncoding("utf8");
      sock.on("connect", () => { sock.write(line); });
      sock.on("data", (chunk: string) => { buf += chunk; });
      sock.on("error", (error) => { finish(() => { reject(error); }); });
      sock.on("close", () => {
        finish(() => {
          try {
            resolve(decodeResponse(buf));
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        });
      });
    });
  }
}

const AcquireResult = z.object({ sandbox_id: z.string().min(1) });

/** Read `result` off an `ok`/`running` envelope, else throw the envelope error. */
function resultOf(res: GatewayResponse): unknown {
  if (res.status === "rejected" || res.status === "error") {
    throw new Error(`${res.error.kind}: ${res.error.message}`);
  }
  return res.result;
}

function isConnectionRefused(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ECONNREFUSED"
  );
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
