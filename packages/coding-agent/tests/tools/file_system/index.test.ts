import { describe, expect, it } from "vitest";

import { createSandboxTools } from "../../../src/tools/sandbox/index.js";
import type {
  GatewayRequest,
  GatewayResponse,
} from "../../../src/sandbox/gateway-client.js";
import type { SandboxToolRuntime } from "../../../src/sandbox/service.js";
import type {
  ToolCallContext,
  ToolDefinition,
  ToolResult,
} from "@ephai/agent-core";
import type { AgentRunId } from "@ephai/agent-engine/runs";

const RUN_ID = "run-1" as AgentRunId;

/** A gateway client that records the last request and returns a scripted envelope. */
function fakeClient(reply: GatewayResponse): {
  gateway: SandboxToolRuntime["gateway"];
  lastRequest: () => GatewayRequest;
} {
  let last: GatewayRequest | undefined;
  const gateway = {
    call: (req: GatewayRequest): Promise<GatewayResponse> => {
      last = req;
      return Promise.resolve(reply);
    },
  };
  return {
    gateway,
    lastRequest: () => {
      if (last === undefined) throw new Error("no request captured");
      return last;
    },
  };
}

function ctx(): ToolCallContext {
  return {
    toolUseId: "tool-use-1" as ToolCallContext["toolUseId"],
    signal: new AbortController().signal,
    llmMessages: [],
    backgroundTaskSupervisor: {} as ToolCallContext["backgroundTaskSupervisor"],
    notifier: {} as ToolCallContext["notifier"],
  };
}

function toolNamed(
  gateway: SandboxToolRuntime["gateway"],
  name: string,
): ToolDefinition {
  const tool = createSandboxTools({ gateway, sandboxId: () => "sb-1" }, RUN_ID).find(
    (candidate: ToolDefinition) => candidate.name === name,
  );
  if (tool === undefined) throw new Error(`tool "${name}" not found`);
  return tool;
}

async function run(
  reply: GatewayResponse,
  name: string,
  input: Record<string, unknown>,
): Promise<{ result: ToolResult; request: GatewayRequest }> {
  const { gateway, lastRequest } = fakeClient(reply);
  const tool = toolNamed(gateway, name);
  const result = await tool.execute(tool.input.parse(input), ctx());
  return { result, request: lastRequest() };
}

const ok = (result: unknown): GatewayResponse =>
  ({ status: "ok", result }) as GatewayResponse;

describe("file_system tool arg adapters", () => {
  it("threads sandbox_id, invocation_id and caller_id on every call", async () => {
    const { request } = await run(ok({ content: "x" }), "read", { path: "a.txt" });
    expect(request.sandbox_id).toBe("sb-1");
    expect(request.args.caller_id).toBe(RUN_ID);
    expect(request.op).toBe("sandbox.file.read");
  });

  it("maps edit old_string/new_string/replace_all into an edits array", async () => {
    const { request } = await run(ok({ success: true }), "edit", {
      path: "a.txt",
      old_string: "foo",
      new_string: "bar",
      replace_all: true,
    });
    expect(request.op).toBe("sandbox.file.edit");
    expect(request.args.edits).toEqual([
      { old_text: "foo", new_text: "bar", replace_all: true },
    ]);
  });

  it("converts exec timeout_ms to whole seconds and folds cwd into the command", async () => {
    const { request } = await run(ok({ status: "ok", output: { stdout: "" } }), "exec_command", {
      command: "ls",
      cwd: "/work",
      timeout_ms: 2500,
    });
    expect(request.op).toBe("sandbox.command.exec");
    expect(request.args.cmd, "cwd folded as cd && command").toBe("cd /work && ls");
    expect(request.args.timeout, "ms ceil-divided to seconds").toBe(3);
  });

  it("does not fold cwd when absent and omits timeout when unset", async () => {
    const { request } = await run(ok({ status: "ok", output: {} }), "exec_command", {
      command: "ls",
    });
    expect(request.args.cmd).toBe("ls");
    expect(request.args.timeout).toBeUndefined();
  });

  it("maps command_stdin input to chars", async () => {
    const { request } = await run(ok({ status: "ok", output: {} }), "command_stdin", {
      command_id: "cmd-1",
      input: "y\n",
    });
    expect(request.op).toBe("sandbox.command.write_stdin");
    expect(request.args.chars).toBe("y\n");
  });

  it("maps read_command_transcript limit to last_n_lines on the poll op", async () => {
    const { request } = await run(ok({ status: "ok", output: {} }), "read_command_transcript", {
      command_id: "cmd-1",
      limit: 20,
    });
    expect(request.op).toBe("sandbox.command.poll");
    expect(request.args.last_n_lines).toBe(20);
  });
});

describe("file_system command response adapter", () => {
  it("returns a poll handle for a running command (envelope ok, result.status running)", async () => {
    const { result } = await run(
      ok({ status: "running", command_id: "cmd-9", output: { stdout: "..." } }),
      "exec_command",
      { command: "sleep 5" },
    );
    expect("output" in result).toBe(true);
    if ("output" in result) {
      expect(result.output).toMatchObject({ status: "running", command_id: "cmd-9" });
    }
  });

  it("returns output for a completed command", async () => {
    const { result } = await run(
      ok({ status: "ok", exit_code: 0, output: { stdout: "done" } }),
      "exec_command",
      { command: "echo done" },
    );
    if ("output" in result) {
      expect(result.output).toMatchObject({ status: "ok", exit_code: 0 });
    } else {
      throw new Error("expected output");
    }
  });

  it.each(["error", "timed_out", "cancelled"])(
    "surfaces an error for a %s command status",
    async (status) => {
      const { result } = await run(
        ok({ status, output: { stderr: "command_not_found" } }),
        "exec_command",
        { command: "nope" },
      );
      expect("error" in result, `result.status ${status} maps to an error`).toBe(true);
    },
  );
});

describe("file_system envelope-first error adapter", () => {
  it("surfaces a rejected envelope as an error before reading result.status", async () => {
    const reply = {
      status: "rejected",
      error: { kind: "occ_conflict", message: "conflict" },
    } as GatewayResponse;
    const { result } = await run(reply, "write", { path: "a.txt", content: "x" });
    expect("error" in result).toBe(true);
    if ("error" in result) expect(result.error).toContain("occ_conflict");
  });
});

describe("file_system file read client-side window", () => {
  it("slices content by line offset and limit", async () => {
    const { result } = await run(
      ok({ content: "l0\nl1\nl2\nl3", exists: true }),
      "read",
      { path: "a.txt", offset: 1, limit: 2 },
    );
    if ("output" in result) {
      expect(result.output).toMatchObject({ content: "l1\nl2" });
    } else {
      throw new Error("expected output");
    }
  });
});
