import type {
  AgentOutcomeFn,
  JsonObject,
  JsonValue,
  UserMessage,
} from "@ephai/agent-core";
import { createAgentOutcomeFn } from "@ephai/agent-core";
import type {
  AgentNodeStartSpec,
  NodeLaunchRequest,
  NodeRunEventBody,
  NodeRunEvent,
  NodeRunHandle,
  NodeRunSnapshot,
  NodeRunner as SdkNodeRunner,
  NodeSettlement,
  WorkflowNodeStartSpec,
} from "@ephai/agent-core/nodes";

import type { AgentFactory } from "../agents/agent-factory.js";
import type { AgenticWorkflowFactory } from "../agentic-workflows/agentic-workflow-factory.js";
import {
  type NodeRunId,
  type NodeRunStore,
  type WorkflowRunId,
} from "../runs/index.js";
import { LiveEventStream } from "../runs/live-event-stream.js";

export class NodeRunner implements SdkNodeRunner {
  readonly #workflowRunId: WorkflowRunId;
  readonly #nodeRunStore: NodeRunStore;
  readonly #agentFactory: () => AgentFactory;
  readonly #workflowFactory: () => AgenticWorkflowFactory;

  constructor(fields: {
    workflowRunId: WorkflowRunId;
    nodeRunStore: NodeRunStore;
    agentFactory: () => AgentFactory;
    workflowFactory: () => AgenticWorkflowFactory;
  }) {
    this.#workflowRunId = fields.workflowRunId;
    this.#nodeRunStore = fields.nodeRunStore;
    this.#agentFactory = fields.agentFactory;
    this.#workflowFactory = fields.workflowFactory;
  }

  async launch<TPayload extends JsonValue = JsonValue>(
    request: NodeLaunchRequest<TPayload>,
  ): Promise<NodeRunHandle<TPayload>> {
    const { nodeRunId } = await this.#nodeRunStore.create({
      workflowRunId: this.#workflowRunId,
      nodeKind: request.start.node.kind,
      nodeName: request.start.node.name,
      ...(request.metadata !== undefined && { metadata: request.metadata }),
    });
    try {
      return request.start.node.kind === "agent"
        ? await this.#launchAgentNode(nodeRunId, request)
        : await this.#launchWorkflowNode(nodeRunId, request);
    } catch (error) {
      await this.#nodeRunStore.failStart({
        nodeRunId,
        reason: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  async #launchAgentNode<TPayload extends JsonValue>(
    nodeRunId: NodeRunId,
    request: NodeLaunchRequest<TPayload>,
  ): Promise<NodeRunHandle<TPayload>> {
    if (request.start.node.kind !== "agent") {
      throw new Error("expected agent node launch request");
    }
    const start = request.start as AgentNodeStartSpec<TPayload>;
    const delegatedRun = await this.#agentFactory()
      .createAgent({
        agentName: start.node.name,
        outcome: submitWorkflowDelegationOutcome(request),
      })
      .start(
        { messages: start.input.messages as UserMessage[] },
        {
          parentWorkflowRunId: this.#workflowRunId,
          parentNodeRunId: nodeRunId,
        },
      );

    const nodeHandle = createNodeHandle<TPayload>({
      nodeRunId,
      request,
      store: this.#nodeRunStore,
      onInterrupt: () => {
        delegatedRun.interrupt();
      },
      settle: async () => {
        const outcome = await delegatedRun.outcome();
        if (outcome.status === "completed") {
          const result = await request.completion.submit(outcome.outcome);
          if ("reject" in result) {
            if (result.reject === "node run is already finished") {
              return {
                status: "completed",
                outcome: {
                  outcomeName: request.start.outcome.name,
                  outcome: outcome.outcome,
                },
              };
            }
            return { status: "rejected", reason: result.reject };
          }
          return { status: "completed", outcome: result.accept };
        }
        if (outcome.status === "cancelled") {
          return { status: "cancelled", reason: "agent run cancelled" };
        }
        return {
          status: "failed",
          reason: outcome.error.message,
        };
      },
    });
    await this.#nodeRunStore.registerHandle({ nodeRunId, handle: nodeHandle });
    return nodeHandle;
  }

  async #launchWorkflowNode<TPayload extends JsonValue>(
    nodeRunId: NodeRunId,
    request: NodeLaunchRequest<TPayload>,
  ): Promise<NodeRunHandle<TPayload>> {
    if (request.start.node.kind !== "workflow") {
      throw new Error("expected workflow node launch request");
    }
    const start = request.start as WorkflowNodeStartSpec<TPayload>;
    const delegatedWorkflowRun = await this.#workflowFactory()
      .createWorkflow({
        workflowName: start.node.name,
        args: start.input.args,
      })
      .start({
        parentWorkflowRunId: this.#workflowRunId,
        parentNodeRunId: nodeRunId,
      });

    const nodeHandle = createNodeHandle<TPayload>({
      nodeRunId,
      request,
      store: this.#nodeRunStore,
      onInterrupt: (reason) => delegatedWorkflowRun.interrupt(reason),
      settle: async () => {
        const outcome = await delegatedWorkflowRun.outcome();
        if (outcome.status === "cancelled") {
          return { status: "cancelled", reason: outcome.reason };
        }
        if (outcome.status !== "success") {
          return {
            status: "failed",
            reason: outcome.reason ?? `workflow ended with ${outcome.status}`,
          };
        }
        const parsed = request.start.outcome.schema.safeParse(outcome.output);
        if (!parsed.success) {
          return {
            status: "rejected",
            reason: `delegated workflow output did not satisfy ${request.start.outcome.name}`,
          };
        }
        const result = await request.completion.submit(parsed.data);
        if ("reject" in result) return { status: "rejected", reason: result.reject };
        return { status: "completed", outcome: result.accept };
      },
    });
    await this.#nodeRunStore.registerHandle({ nodeRunId, handle: nodeHandle });
    return nodeHandle;
  }
}

function createNodeHandle<TPayload extends JsonValue>(input: {
  nodeRunId: NodeRunId;
  request: NodeLaunchRequest<TPayload>;
  store: NodeRunStore;
  onInterrupt(reason: string): Promise<void> | void;
  settle(): Promise<NodeSettlement<TPayload>>;
}): NodeRunHandle<TPayload> {
  const startedAt = new Date().toISOString();
  const stream = new LiveEventStream<NodeRunEvent>();
  let status: NodeRunSnapshot["status"] = "running";
  let completedAt: string | undefined;
  let seq = 0;
  let eventWrites = Promise.resolve();

  const emit = (body: NodeRunEventBody): void => {
    const event = {
      ...body,
      nodeName: input.request.start.node.name,
      seq,
      time: new Date().toISOString(),
    } satisfies NodeRunEvent;
    seq += 1;
    stream.push(event);
    eventWrites = eventWrites.then(() =>
      input.store.appendEvent({ nodeRunId: input.nodeRunId, event }),
    );
    void eventWrites.catch(() => undefined);
  };

  emit({
    type: "node_started",
    spec: nodeStartSpecRecord(input.request),
  });

  const abort = (): void => {
    void Promise.resolve(input.onInterrupt(abortReason(input.request.signal))).catch(() => undefined);
  };
  if (input.request.signal !== undefined) {
    if (input.request.signal.aborted) abort();
    else input.request.signal.addEventListener("abort", abort, { once: true });
  }

  const settlement = input.settle().catch((error: unknown): NodeSettlement<TPayload> => ({
    status: "failed",
    reason: error instanceof Error ? error.message : String(error),
  })).then(async (result) => {
    status = result.status;
    completedAt = new Date().toISOString();
    if (result.status === "completed") {
      emit({
        type: "node_outcome_submitted",
        outcome: result.outcome as unknown as JsonObject,
      });
    } else if (result.status === "rejected") {
      emit({ type: "node_outcome_rejected", reason: result.reason });
    }
    emit({ type: "node_settled", settlement: result });
    try {
      await eventWrites;
      await input.store.finish({
        nodeRunId: input.nodeRunId,
        settlement: result,
      });
      return result;
    } finally {
      stream.close();
    }
  }).finally(() => {
    input.request.signal?.removeEventListener("abort", abort);
  });

  return {
    start: input.request.start,
    settlement: () => settlement,
    events: () => stream,
    snapshot: () => ({
      nodeName: input.request.start.node.name,
      ...(input.request.metadata !== undefined && { metadata: input.request.metadata }),
      status,
      startedAt,
      ...(completedAt !== undefined && { completedAt }),
    }),
    steer: () => ({ accepted: false, reason: "unsupported" }),
    interrupt: async (reason) => {
      await input.onInterrupt(reason);
    },
  };
}

function abortReason(signal: AbortSignal | undefined): string {
  if (signal === undefined) return "interrupted";
  const reason: unknown = signal.reason;
  return typeof reason === "string" ? reason : "interrupted";
}

function nodeStartSpecRecord<TPayload extends JsonValue>(
  request: NodeLaunchRequest<TPayload>,
): JsonObject {
  const metadata =
    request.start.node.kind === "agent"
      ? request.start.input.metadata
      : request.start.input.metadata;
  const node: JsonObject = {
    kind: request.start.node.kind,
    name: request.start.node.name,
    ...(request.start.node.description !== undefined && {
      description: request.start.node.description,
    }),
  };
  return {
    node,
    outcome: {
      name: request.start.outcome.name,
      description: request.start.outcome.description,
    },
    ...(request.metadata !== undefined && { metadata: request.metadata }),
    ...(metadata !== undefined && { inputMetadata: metadata }),
  };
}

function submitWorkflowDelegationOutcome<TPayload extends JsonValue>(
  request: NodeLaunchRequest<TPayload>,
): AgentOutcomeFn<TPayload> {
  return createAgentOutcomeFn({
    name: request.start.outcome.name,
    description: request.start.outcome.description,
    schema: request.start.outcome.schema,
    onSubmit: async (payload) => {
      const result = await request.completion.submit(payload);
      return "accept" in result
        ? { accept: result.accept.outcome }
        : { reject: result.reject };
    },
  });
}
