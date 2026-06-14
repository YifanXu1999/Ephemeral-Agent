import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadCodingAgentConfig } from "../../src/config/load.js";

describe("loadCodingAgentConfig", () => {
  it("loads hooks and llm clients from their .ephai config directories", () => {
    const root = join(mkdtempSync(join(tmpdir(), "ephai-config-")), ".ephai");
    mkdirSync(join(root, "agents"), { recursive: true });
    mkdirSync(join(root, "hooks"), { recursive: true });
    mkdirSync(join(root, "llm-clients"), { recursive: true });

    writeFileSync(join(root, "hooks.json"), "not the active hook config");
    writeFileSync(join(root, "llm-clients.json"), "not the active llm config");
    writeFileSync(join(root, "hooks", "hooks.json"), "[]");
    writeFileSync(join(root, "llm-clients", "llm-clients.json"), '{"clients":[]}');

    const config = loadCodingAgentConfig(root);

    expect(config.configBaseDir).toBe(dirname(root));
    expect(config.hooks).toEqual([]);
    expect(config.agentHooks).toEqual({});
    expect(config.llmClients).toEqual({});
  });
});
