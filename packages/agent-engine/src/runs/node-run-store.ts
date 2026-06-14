import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  NodeRunEvent,
  NodeRunHandle,
  NodeSettlement,
} from "@ephai/agent-core/nodes";
import type { JsonObject } from "@ephai/agent-core";

import {
  mintNodeRunId,
  type NodeRunId,
  type WorkflowRunId,
} from "./ids.js";

export interface CreateNodeRunInput {
  workflowRunId: WorkflowRunId;
  nodeKind: "agent" | "workflow";
  nodeName: string;
  metadata?: JsonObject;
}

export interface NodeRunStore {
  create(input: CreateNodeRunInput): Promise<{ nodeRunId: NodeRunId }>;
  registerHandle(input: { nodeRunId: NodeRunId; handle: NodeRunHandle }): Promise<void>;
  appendEvent(input: { nodeRunId: NodeRunId; event: NodeRunEvent }): Promise<void>;
  finish(input: { nodeRunId: NodeRunId; settlement: NodeSettlement }): Promise<void>;
  failStart(input: { nodeRunId: NodeRunId; reason: string }): Promise<void>;
  readEvents(input: {
    nodeRunId: NodeRunId;
    offset: number;
    limit: number;
  }): Promise<{ total: number; lines: string[]; eof: boolean }>;
}

export class JsonlNodeRunStore implements NodeRunStore {
  readonly #rootDir: string;
  readonly #handles = new Map<NodeRunId, NodeRunHandle>();

  constructor(rootDir: string) {
    this.#rootDir = rootDir;
  }

  async create(input: CreateNodeRunInput): Promise<{ nodeRunId: NodeRunId }> {
    const nodeRunId = mintNodeRunId();
    const dir = this.#runDir(nodeRunId);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "meta.json"),
      `${JSON.stringify({
        nodeRunId,
        workflowRunId: input.workflowRunId,
        nodeKind: input.nodeKind,
        nodeName: input.nodeName,
        metadata: input.metadata ?? null,
        status: "running",
        createdAt: new Date().toISOString(),
      })}\n`,
      "utf8",
    );
    return { nodeRunId };
  }

  registerHandle(input: { nodeRunId: NodeRunId; handle: NodeRunHandle }): Promise<void> {
    this.#handles.set(input.nodeRunId, input.handle);
    return Promise.resolve();
  }

  appendEvent(input: { nodeRunId: NodeRunId; event: NodeRunEvent }): Promise<void> {
    return appendFile(
      join(this.#runDir(input.nodeRunId), "events.jsonl"),
      `${JSON.stringify(input.event)}\n`,
      "utf8",
    );
  }

  async finish(input: { nodeRunId: NodeRunId; settlement: NodeSettlement }): Promise<void> {
    await writeFile(
      join(this.#runDir(input.nodeRunId), "outcome.json"),
      `${JSON.stringify({
        status: "finished",
        finishedAt: new Date().toISOString(),
        settlement: input.settlement,
      })}\n`,
      "utf8",
    );
  }

  async failStart(input: { nodeRunId: NodeRunId; reason: string }): Promise<void> {
    await writeFile(
      join(this.#runDir(input.nodeRunId), "outcome.json"),
      `${JSON.stringify({
        status: "start_failed",
        finishedAt: new Date().toISOString(),
        reason: input.reason,
      })}\n`,
      "utf8",
    );
  }

  async readEvents(input: {
    nodeRunId: NodeRunId;
    offset: number;
    limit: number;
  }): Promise<{ total: number; lines: string[]; eof: boolean }> {
    let raw: string;
    try {
      raw = await readFile(
        join(this.#runDir(input.nodeRunId), "events.jsonl"),
        "utf8",
      );
    } catch {
      return { total: 0, lines: [], eof: true };
    }
    const lines = raw.split("\n").filter((line) => line.length > 0);
    const page = lines.slice(input.offset, input.offset + input.limit);
    return {
      total: lines.length,
      lines: page,
      eof: input.offset + input.limit >= lines.length,
    };
  }

  #runDir(nodeRunId: NodeRunId): string {
    return join(this.#rootDir, nodeRunId);
  }
}
