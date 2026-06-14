// Bundled external agentic workflow script.
import {
  defineAgenticWorkflow,
  defineWorkflowImplementation,
  z
} from "@ephai/agent-engine/agentic-workflows";
var RalphArgsSchema = z.object({
  max_attempts: z.number().int().positive().default(3)
}).strict();
var PlannerPayloadSchema = z.strictObject({
  pass: z.boolean(),
  plan: z.string().min(1),
  summary: z.string().min(1)
});
var ReviewerPayloadSchema = z.strictObject({
  pass: z.boolean(),
  review: z.string().min(1),
  summary: z.string().min(1)
});
var CriticPayloadSchema = z.strictObject({
  pass: z.boolean(),
  verdict: z.string().min(1),
  summary: z.string().min(1)
});
var ralphLoopModule = {
  type: "ralph_loop",
  argsSchema: RalphArgsSchema,
  createImplementation: () => defineWorkflowImplementation({
    createInitialState: ({ args }) => {
      const parsed = RalphArgsSchema.parse(args);
      return {
        version: 0,
        is_workflow_done: false,
        workflow_status: "running",
        attempt: 1,
        maxAttempts: parsed.max_attempts,
        phase: "planner",
        failures: []
      };
    },
    dispatch: ({ definition, state, runtime }) => {
      const phase = state.phase;
      if (state.is_workflow_done || phase === "done") return [];
      if (runtime.runningNodes.length > 0) return [];
      const node = bindingFor(definition, phase);
      if (node === void 0) return [];
      return [
        {
          start: startFor({ ...state, phase }, node),
          metadata: { role: phase, attempt: state.attempt }
        }
      ];
    },
    validateNodeSettlement: ({ state, settlement }) => {
      const role = settlementRole(settlement);
      if (state.phase === "done") {
        return { ok: false, reason: "workflow is already done" };
      }
      if (role !== state.phase) {
        return {
          ok: false,
          reason: `settlement role "${role ?? "unknown"}" does not match phase "${state.phase}"`
        };
      }
      return { ok: true };
    },
    applyNodeSettlement: ({ state, settlement }) => {
      if (state.phase === "done") return { state };
      const phase = state.phase;
      const failure = settlementFailure(settlement, phase);
      if (failure !== void 0) {
        return withTransition(
          {
            ...state,
            version: state.version + 1,
            failures: [...state.failures, failure]
          },
          "ralph_node_failed",
          { phase, attempt: state.attempt, reason: failure }
        );
      }
      if (settlement.status !== "completed") return { state };
      const payload = settlement.accepted.outcome;
      if (phase === "planner") {
        return withTransition(
          {
            ...state,
            version: state.version + 1,
            planner: PlannerPayloadSchema.parse(payload)
          },
          "ralph_planner_submitted",
          { attempt: state.attempt }
        );
      }
      if (phase === "reviewer") {
        return withTransition(
          {
            ...state,
            version: state.version + 1,
            reviewer: ReviewerPayloadSchema.parse(payload)
          },
          "ralph_reviewer_submitted",
          { attempt: state.attempt }
        );
      }
      return withTransition(
        {
          ...state,
          version: state.version + 1,
          critic: CriticPayloadSchema.parse(payload)
        },
        "ralph_critic_submitted",
        { attempt: state.attempt }
      );
    },
    evaluateWorkflowProgress: ({ state }) => {
      if (state.is_workflow_done || state.phase === "done") return { state };
      if (state.last_transition?.type === "ralph_node_failed") {
        return retryOrFail(state, transitionReason(state.last_transition));
      }
      if (state.phase === "planner" && state.planner !== void 0) {
        if (!state.planner.pass) return retryOrFail(state, `planner failed: ${state.planner.summary}`);
        return advance(state, "reviewer", "ralph_planner_passed");
      }
      if (state.phase === "reviewer" && state.reviewer !== void 0) {
        if (!state.reviewer.pass) return retryOrFail(state, `reviewer failed: ${state.reviewer.summary}`);
        return advance(state, "critic", "ralph_reviewer_passed");
      }
      if (state.phase === "critic" && state.critic !== void 0) {
        if (!state.critic.pass) return retryOrFail(state, `critic failed: ${state.critic.summary}`);
        return withTransition(
          {
            ...state,
            phase: "done",
            is_workflow_done: true,
            workflow_status: "success"
          },
          "ralph_succeeded",
          { attempt: state.attempt }
        );
      }
      return { state };
    },
    deadlock: ({ state, runtime, lastDispatches }) => {
      if (state.is_workflow_done) return null;
      if (runtime.runningNodes.length > 0) return null;
      if (lastDispatches.length > 0) return null;
      return {
        reason: "ralph loop has no dispatchable node",
        details: {
          attempt: state.attempt,
          phase: state.phase,
          lastTransition: state.last_transition ?? {}
        }
      };
    },
    getWorkflowOutcome: (state) => workflowOutcome(state)
  })
};
function bindingFor(definition, phase) {
  const bindings = definition.metadata?.nodeBindings;
  if (!isBindingMap(bindings)) return void 0;
  return bindings[phase];
}
function outcomeFor(phase) {
  if (phase === "planner") {
    return {
      name: "submit_planner_ralph_outcome",
      description: "Submit the Ralph planner result for this attempt.",
      schema: PlannerPayloadSchema
    };
  }
  if (phase === "reviewer") {
    return {
      name: "submit_reviewer_ralph_outcome",
      description: "Submit the Ralph reviewer result for this attempt.",
      schema: ReviewerPayloadSchema
    };
  }
  return {
    name: "submit_critic_ralph_outcome",
    description: "Submit the Ralph critic result for this attempt.",
    schema: CriticPayloadSchema
  };
}
function startFor(state, node) {
  const metadata = { role: state.phase, attempt: state.attempt };
  if (node.kind === "agent") {
    return {
      node,
      input: {
        messages: buildMessages(state),
        metadata
      },
      outcome: outcomeFor(state.phase)
    };
  }
  return {
    node,
    input: {
      args: {
        phase: state.phase,
        attempt: state.attempt,
        planner: state.planner ?? null,
        reviewer: state.reviewer ?? null
      },
      metadata
    },
    outcome: outcomeFor(state.phase)
  };
}
function buildMessages(state) {
  const text = state.phase === "planner" ? `Attempt ${String(state.attempt)}: produce a concise implementation plan.` : state.phase === "reviewer" ? `Attempt ${String(state.attempt)}: review this plan and decide whether it passes.

${state.planner?.plan ?? ""}` : `Attempt ${String(state.attempt)}: critique the accepted plan and review.

Plan: ${state.planner?.plan ?? ""}
Review: ${state.reviewer?.review ?? ""}`;
  return [{ role: "user", content: [{ type: "text", text }] }];
}
function transitionReason(transition) {
  return typeof transition.reason === "string" ? transition.reason : "node failed";
}
function settlementRole(settlement) {
  const metadata = settlement.status === "completed" ? settlement.accepted.metadata : settlement.metadata;
  const role = metadata?.role;
  return typeof role === "string" ? role : void 0;
}
function settlementFailure(settlement, phase) {
  if (settlement.status === "completed") return void 0;
  if (settlement.status === "cancelled") return `${phase} cancelled: ${settlement.reason ?? "cancelled"}`;
  return `${phase} ${settlement.status}: ${settlement.reason}`;
}
function retryOrFail(state, reason) {
  const failures = state.failures.includes(reason) ? state.failures : [...state.failures, reason];
  if (state.attempt < state.maxAttempts) {
    return withTransition(
      {
        ...state,
        attempt: state.attempt + 1,
        phase: "planner",
        planner: void 0,
        reviewer: void 0,
        critic: void 0,
        failures
      },
      "ralph_retrying",
      { attempt: state.attempt + 1, reason }
    );
  }
  return withTransition(
    {
      ...state,
      is_workflow_done: true,
      workflow_status: "failure",
      failures
    },
    "ralph_failed",
    { attempt: state.attempt, reason }
  );
}
function advance(state, phase, type) {
  return withTransition({ ...state, phase }, type, {
    attempt: state.attempt,
    phase
  });
}
function withTransition(state, type, rest = {}) {
  const transition = { type, ...rest };
  return {
    state: { ...state, last_transition: transition },
    transition
  };
}
function workflowOutcome(state) {
  if (!state.is_workflow_done) return null;
  if (state.workflow_status === "success") {
    return {
      status: "success",
      output: {
        planner_summary: state.planner?.summary ?? "",
        reviewer_summary: state.reviewer?.summary ?? "",
        critic_summary: state.critic?.summary ?? ""
      }
    };
  }
  return {
    status: "failure",
    reason: `ralph failed after ${String(state.attempt)} attempt(s)`,
    output: {
      attempts: state.attempt,
      failures: state.failures
    }
  };
}
function isBindingMap(value) {
  if (typeof value !== "object" || value === null) return false;
  const bindings = value;
  return ["planner", "reviewer", "critic"].every((role) => isBinding(bindings[role]));
}
function isBinding(value) {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value;
  return (candidate.kind === "agent" || candidate.kind === "workflow") && typeof candidate.name === "string";
}
export {
  CriticPayloadSchema,
  PlannerPayloadSchema,
  ReviewerPayloadSchema,
  ralphLoopModule
};
export default defineAgenticWorkflow(ralphLoopModule);
