import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveScriptCommand, runJsonScript } from "../../src/scripts/script-runner.js";

describe("script runner", () => {
  it.each([
    ["cjs", "echo.cjs", "process.stdin.on(\"data\", (chunk) => input += chunk);"],
    ["ts", "echo.ts", "process.stdin.on(\"data\", (chunk: Buffer) => input += chunk.toString());"],
  ])("runs a %s script with JSON stdin", async (_label, file, stdinLine) => {
    const dir = mkdtempSync(join(tmpdir(), "eos-script-runner-"));
    const path = join(dir, file);
    writeFileSync(
      path,
      [
        "let input = \"\";",
        stdinLine,
        "process.stdin.on(\"end\", () => {",
        "  const payload = JSON.parse(input);",
        "  process.stdout.write(JSON.stringify({ echoed: payload.value }));",
        "});",
      ].join("\n"),
    );

    const result = await runJsonScript(resolveScriptCommand(dir, path), { value: file });

    expect(result).toEqual({
      kind: "exited",
      code: 0,
      stdout: JSON.stringify({ echoed: file }),
      stderr: "",
    });
  });

  it("rejects unsupported script extensions", () => {
    const dir = mkdtempSync(join(tmpdir(), "eos-script-runner-"));

    expect(() => resolveScriptCommand(dir, "script.txt")).toThrow(/must be a \.cjs/);
  });
});
