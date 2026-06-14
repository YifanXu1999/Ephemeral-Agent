import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

import type { AgenticWorkflowConfig } from "@ephai/agent-engine/agentic-workflows";
import { zodIssues } from "./diagnostics.js";

/** A valid tool-name fragment: snake_case, so providers can name tools off it. */
const TOOL_NAME = /^[a-z][a-z0-9_]*$/;
const FRONTMATTER_SHAPE = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n[\s\S]*|)$/;
const RESERVED_TOOL = "read_workflow_docs";

const ParticipantBindingSchema = z
  .object({
    kind: z.enum(["agent", "workflow"]),
    name: z.string().min(1),
    description: z.string().min(1).optional(),
  })
  .strict();

const FrontmatterSchema = z
  .object({
    name: z.string().min(1),
    type: z.string().min(1),
    description: z.string().min(1),
    module: z.string().min(1).optional(),
    participants: z.record(z.string().min(1), ParticipantBindingSchema).default({}),
    tools: z.array(z.string().min(1)).min(1),
    args: z.unknown().optional(),
  })
  .strict();

/** Load every `<root>/<name>/workflow.md` agentic workflow. A missing root means none. */
export function loadAgenticWorkflowConfigs(root: string): AgenticWorkflowConfig[] {
  let dirs: string[];
  try {
    dirs = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
      .map((entry) => entry.name);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
  const configs: AgenticWorkflowConfig[] = [];
  const seen = new Set<string>();
  for (const dir of dirs.sort()) {
    const configPath = join(root, dir, "workflow.md");
    if (!existsSync(configPath)) {
      throw new Error(`agentic workflow directory ${join(root, dir)} must contain workflow.md`);
    }
    const config = loadAgenticWorkflowConfig(configPath, dir);
    if (seen.has(config.name)) {
      throw new Error(`duplicate agentic workflow name "${config.name}"`);
    }
    seen.add(config.name);
    configs.push(config);
  }
  return configs;
}

function loadAgenticWorkflowConfig(path: string, workflowName: string): AgenticWorkflowConfig {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    throw new Error(`agentic workflow config ${path} is not readable`, { cause: error });
  }
  const match = FRONTMATTER_SHAPE.exec(raw);
  if (!match) {
    throw new Error(`agentic workflow config ${path} must open with a --- YAML frontmatter block`);
  }
  let data: unknown;
  try {
    data = parseYaml(match[1]);
  } catch (error) {
    throw new Error(`agentic workflow config ${path} has invalid YAML frontmatter`, { cause: error });
  }
  const parsed = FrontmatterSchema.safeParse(data);
  if (!parsed.success) {
    throw new Error(`agentic workflow config ${path} is invalid: ${zodIssues(parsed.error)}`);
  }
  if (parsed.data.name !== workflowName) {
    throw new Error(
      `agentic workflow config ${path} name "${parsed.data.name}" must equal directory "${workflowName}"`,
    );
  }
  if (!TOOL_NAME.test(parsed.data.name)) {
    throw new Error(`agentic workflow name "${parsed.data.name}" must be a snake_case tool-name fragment`);
  }
  for (const tool of parsed.data.tools) {
    if (!TOOL_NAME.test(tool)) {
      throw new Error(`agentic workflow "${parsed.data.name}" declares invalid tool name "${tool}"`);
    }
    if (tool === RESERVED_TOOL) {
      throw new Error(`agentic workflow "${parsed.data.name}" must not declare ${RESERVED_TOOL}`);
    }
  }
  if (new Set(parsed.data.tools).size !== parsed.data.tools.length) {
    throw new Error(`agentic workflow "${parsed.data.name}" declares duplicate tool names`);
  }
  return {
    name: parsed.data.name,
    type: parsed.data.type,
    ...(parsed.data.module !== undefined && {
      module: resolve(dirname(path), parsed.data.module),
    }),
    args: parsed.data.args,
    description: parsed.data.description,
    docs: match[2].trim(),
    participants: parsed.data.participants,
    tools: parsed.data.tools,
  };
}
