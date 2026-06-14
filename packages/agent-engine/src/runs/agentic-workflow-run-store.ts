import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type {
  WorkflowOutcome,
  WorkflowRunEvent,
  WorkflowRunHandle as SdkWorkflowRunHandle,
  WorkflowRunSnapshot,
  WorkflowSteer,
} from "@ephai/agent-core/agentic-workflows";

import { LiveEventStream } from "./live-event-stream.js";
import {
  mintWorkflowRunId,
  type NodeRunId,
  type WorkflowRunId,
} from "./ids.js";

export interface CodingWorkflowRunHandle {
  readonly workflowRunId: WorkflowRunId;
  readonly definition: SdkWorkflowRunHandle["definition"];
  outcome(): Promise<WorkflowOutcome>;
  events(): AsyncIterable<WorkflowRunEvent>;
  snapshot(): WorkflowRunSnapshot;
  steer(input: WorkflowSteer): ReturnType<SdkWorkflowRunHandle["steer"]>;
  interrupt(reason: string): Promise<void>;
}

export async function bridgeWorkflowRun(input: {
  workflowRunId: WorkflowRunId;
  sdkHandle: SdkWorkflowRunHandle;
  store: WorkflowRunStore;
}): Promise<CodingWorkflowRunHandle> {
  const stream = new LiveEventStream<WorkflowRunEvent>();
  const outcome = input.sdkHandle.outcome().then(async (result) => {
    await input.store.finish({
      workflowRunId: input.workflowRunId,
      outcome: result,
    });
    return result;
  });
  void (async () => {
    try {
      for await (const event of input.sdkHandle.events()) {
        await input.store.appendEvent({
          workflowRunId: input.workflowRunId,
          event,
        });
        if (event.type === "workflow_snapshot_recorded") {
          await input.store.recordSnapshot({
            workflowRunId: input.workflowRunId,
            snapshot: input.sdkHandle.snapshot(),
          });
        }
        stream.push(event);
      }
    } finally {
      stream.close();
    }
  })();
  const handle: CodingWorkflowRunHandle = {
    workflowRunId: input.workflowRunId,
    definition: input.sdkHandle.definition,
    outcome: () => outcome,
    events: () => stream,
    snapshot: () => input.sdkHandle.snapshot(),
    steer: (steer) => input.sdkHandle.steer(steer),
    interrupt: (reason) => input.sdkHandle.interrupt(reason),
  };
  await input.store.registerHandle({
    workflowRunId: input.workflowRunId,
    handle,
  });
  return handle;
}

export interface CreateWorkflowRunInput {
  workflowName: string;
  parentWorkflowRunId?: WorkflowRunId;
  parentNodeRunId?: NodeRunId;
}

export interface WorkflowRunStore {
  create(input: CreateWorkflowRunInput): Promise<{ workflowRunId: WorkflowRunId }>;
  registerHandle(input: {
    workflowRunId: WorkflowRunId;
    handle: CodingWorkflowRunHandle;
  }): Promise<void>;
  appendEvent(input: { workflowRunId: WorkflowRunId; event: WorkflowRunEvent }): Promise<void>;
  recordSnapshot(input: {
    workflowRunId: WorkflowRunId;
    snapshot: WorkflowRunSnapshot;
  }): Promise<void>;
  readLatestSnapshot(input: {
    workflowRunId: WorkflowRunId;
  }): Promise<WorkflowRunSnapshot | undefined>;
  finish(input: { workflowRunId: WorkflowRunId; outcome: WorkflowOutcome }): Promise<void>;
  failStart(input: { workflowRunId: WorkflowRunId; reason: string }): Promise<void>;
  readEvents(input: {
    workflowRunId: WorkflowRunId;
    offset: number;
    limit: number;
  }): Promise<{ total: number; lines: string[]; eof: boolean }>;
}

export class JsonlWorkflowRunStore implements WorkflowRunStore {
  readonly #rootDir: string;
  readonly #handles = new Map<WorkflowRunId, CodingWorkflowRunHandle>();

  constructor(rootDir: string) {
    this.#rootDir = rootDir;
  }

  async create(input: CreateWorkflowRunInput): Promise<{ workflowRunId: WorkflowRunId }> {
    const workflowRunId = mintWorkflowRunId();
    const dir = this.#runDir(workflowRunId);
    await mkdir(dir, { recursive: true });
    await writeFile(
      join(dir, "meta.json"),
      `${JSON.stringify({
        workflowRunId,
        workflowName: input.workflowName,
        parentWorkflowRunId: input.parentWorkflowRunId ?? null,
        parentNodeRunId: input.parentNodeRunId ?? null,
        status: "running",
        createdAt: new Date().toISOString(),
      })}\n`,
      "utf8",
    );
    return { workflowRunId };
  }

  registerHandle(input: {
    workflowRunId: WorkflowRunId;
    handle: CodingWorkflowRunHandle;
  }): Promise<void> {
    this.#handles.set(input.workflowRunId, input.handle);
    return Promise.resolve();
  }

  appendEvent(input: { workflowRunId: WorkflowRunId; event: WorkflowRunEvent }): Promise<void> {
    return appendFile(
      join(this.#runDir(input.workflowRunId), "events.jsonl"),
      `${JSON.stringify(input.event)}\n`,
      "utf8",
    );
  }

  async recordSnapshot(input: {
    workflowRunId: WorkflowRunId;
    snapshot: WorkflowRunSnapshot;
  }): Promise<void> {
    await writeFile(
      join(this.#runDir(input.workflowRunId), "latest-snapshot.json"),
      `${JSON.stringify(input.snapshot)}\n`,
      "utf8",
    );
  }

  async readLatestSnapshot(input: {
    workflowRunId: WorkflowRunId;
  }): Promise<WorkflowRunSnapshot | undefined> {
    let raw: string;
    try {
      raw = await readFile(
        join(this.#runDir(input.workflowRunId), "latest-snapshot.json"),
        "utf8",
      );
    } catch {
      return undefined;
    }
    return JSON.parse(raw) as WorkflowRunSnapshot;
  }

  async finish(input: { workflowRunId: WorkflowRunId; outcome: WorkflowOutcome }): Promise<void> {
    await writeFile(
      join(this.#runDir(input.workflowRunId), "outcome.json"),
      `${JSON.stringify({
        status: "finished",
        finishedAt: new Date().toISOString(),
        outcome: input.outcome,
      })}\n`,
      "utf8",
    );
  }

  async failStart(input: { workflowRunId: WorkflowRunId; reason: string }): Promise<void> {
    await writeFile(
      join(this.#runDir(input.workflowRunId), "outcome.json"),
      `${JSON.stringify({
        status: "start_failed",
        finishedAt: new Date().toISOString(),
        reason: input.reason,
      })}\n`,
      "utf8",
    );
  }

  async readEvents(input: {
    workflowRunId: WorkflowRunId;
    offset: number;
    limit: number;
  }): Promise<{ total: number; lines: string[]; eof: boolean }> {
    let raw: string;
    try {
      raw = await readFile(
        join(this.#runDir(input.workflowRunId), "events.jsonl"),
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

  #runDir(workflowRunId: WorkflowRunId): string {
    return join(this.#rootDir, workflowRunId);
  }
}
