// Bundled external agentic workflow script.
import { randomUUID } from "node:crypto";
import {
  defineAgenticWorkflow,
  defineWorkflowImplementation,
  z
} from "@ephai/agent-engine/agentic-workflows";
var DEFAULT_MAX_ATTEMPTS = 2;
var CONTEXT_SNIPPET_RADIUS = 48;
var NonEmptyStringListSchema = z.tuple([
  z.string().min(1)
], z.string().min(1));
var CreatePursuitInputSchema = z.strictObject({
  pursuit_goal: z.string().min(1),
  leg_goals: NonEmptyStringListSchema.optional()
});
var PursuitArgsSchema = CreatePursuitInputSchema.extend({
  max_attempts: z.number().int().positive().default(DEFAULT_MAX_ATTEMPTS)
});
var PursuitEntityRunStatusSchema = z.enum([
  "NotStarted",
  "Running",
  "Success",
  "Failed",
  "Cancelled"
]);
var WorkItemRunStatusSchema = z.enum([
  "NotStarted",
  "Running",
  "Success",
  "Failed",
  "Blocked",
  "Cancelled"
]);
function isPursuitEntityTerminal(status) {
  return status === "Success" || status === "Failed" || status === "Cancelled";
}
function isWorkItemTerminal(status) {
  return status === "Success" || status === "Failed" || status === "Blocked" || status === "Cancelled";
}
var AttemptFailureReasonSchema = z.strictObject({
  work_item_id: z.string().nullable(),
  kind: z.enum([
    "planner_failed",
    "context_composition_failed",
    "failed",
    "blocked_by_failed_dependency"
  ]),
  message: z.string().nullable(),
  summary: z.string().nullable(),
  outcome: z.string().nullable(),
  blocked_by: z.array(z.string()).optional()
});
var PlannerWorkItemSpecSchema = z.strictObject({
  id: z.string().min(1),
  agent_name: z.string().min(1),
  title: z.string().min(1),
  spec: z.string().min(1),
  depends_on: z.array(z.string().min(1)).default([])
});
var PlannerOutcomePayloadSchema = z.strictObject({
  summary: z.string().min(1),
  leg_goal: z.string().min(1).optional(),
  next_leg_goal: z.string().min(1).optional(),
  work_items: z.array(PlannerWorkItemSpecSchema).min(1)
});
var WorkerOutcomePayloadSchema = z.strictObject({
  summary: z.string().min(1),
  is_pass: z.boolean(),
  outcome: z.string().min(1)
});
function mintPursuitId() {
  return randomUUID();
}
function pursuitIdFrom(raw) {
  if (raw.length === 0) throw new Error("pursuit id must not be empty");
  return raw;
}
function workItemIdFrom(raw) {
  if (raw.length === 0) throw new Error("work item id must not be empty");
  return raw;
}
var pursuitModule = {
  type: "pursuit",
  argsSchema: PursuitArgsSchema,
  createImplementation: () => defineWorkflowImplementation({
    createInitialState: ({ args }) => createInitialState(PursuitArgsSchema.parse(args)),
    dispatch: ({ definition, state, runtime }) => {
      if (state.is_workflow_done) return [];
      const running = runningMetadata(runtime);
      const dispatches = [];
      for (const leg of state.legs) {
        if (leg.status !== "Running") continue;
        const attempt = leg.attempts.at(-1);
        if (attempt?.status !== "Running") continue;
        if (attempt.plan.status === "NotStarted") {
          if (running.plans.has(attempt.plan.id)) continue;
          const node2 = bindingFor(definition, "planner");
          if (node2 !== void 0) {
            dispatches.push(plannerDispatch(state, leg, attempt, node2));
          }
          continue;
        }
        if (attempt.plan.status !== "Success") continue;
        const node = bindingFor(definition, "worker");
        if (node === void 0) continue;
        for (const item of attempt.workItems) {
          if (item.status !== "NotStarted") continue;
          if (running.workItems.has(item.key)) continue;
          if (!dependenciesSucceeded(leg, item)) continue;
          dispatches.push(workerDispatch(state, leg, attempt, item, node));
        }
      }
      return dispatches;
    },
    validateNodeSettlement: ({ state, settlement }) => {
      if (state.is_workflow_done) return { ok: false, reason: "workflow is already done" };
      const metadata = settlementMetadata(settlement);
      if (metadata === void 0) {
        return { ok: false, reason: "pursuit settlement is missing role metadata" };
      }
      if (metadata.role === "planner") {
        const located2 = findAttempt(state, metadata);
        if (located2 === void 0) return { ok: false, reason: "unknown planner attempt" };
        if (isPursuitEntityTerminal(located2.attempt.plan.status)) {
          return { ok: false, reason: "planner target is already terminal" };
        }
        if (settlement.status !== "completed") return { ok: true };
        const payload = PlannerOutcomePayloadSchema.parse(settlement.accepted.outcome);
        const error = plannerSubmissionError(state, located2.leg, located2.attempt, payload);
        return error === void 0 ? { ok: true } : { ok: false, reason: error };
      }
      const located = findWorkItem(state, metadata);
      if (located === void 0) return { ok: false, reason: "unknown worker item" };
      if (isWorkItemTerminal(located.item.status)) {
        return { ok: false, reason: "worker target is already terminal" };
      }
      return { ok: true };
    },
    applyNodeSettlement: ({ state, settlement }) => {
      const metadata = settlementMetadata(settlement);
      if (metadata === void 0) return { state };
      if (metadata.role === "planner") {
        return applyPlannerSettlement(state, metadata, settlement);
      }
      return applyWorkerSettlement(state, metadata, settlement);
    },
    evaluateWorkflowProgress: ({ state, runtime }) => {
      const running = runningMetadata(runtime);
      return reconcilePursuitProgress(state, running);
    },
    deadlock: ({ state, runtime, lastDispatches }) => {
      if (state.is_workflow_done) return null;
      if (runtime.runningNodes.length > 0) return null;
      if (lastDispatches.length > 0) return null;
      return {
        reason: "pursuit has no dispatchable node",
        details: {
          pursuit_id: state.pursuit.id,
          latest_leg_id: state.legs.at(-1)?.id ?? null,
          lastTransition: state.last_transition ?? {}
        }
      };
    },
    getWorkflowOutcome: (state) => workflowOutcome(state)
  })
};
function createPursuitContextStore(options = {}) {
  const handles = /* @__PURE__ */ new Map();
  const readLatestSnapshot = options.workflowRunStore?.readLatestSnapshot;
  return {
    projectInitialContext: (input) => {
      handles.set(input.workflowRunId, input.handle);
      return Promise.resolve();
    },
    listContext: async (input) => {
      const context = await contextForWorkflowRun(handles, input.workflowRecordId, readLatestSnapshot);
      return {
        entries: context === void 0 ? [] : listContextRows(context)
      };
    },
    queryContext: async (input) => {
      const context = await contextForWorkflowRun(handles, input.workflowRecordId, readLatestSnapshot);
      return {
        results: context === void 0 ? [] : searchContextRows(context, input.query.text)
      };
    }
  };
}
function createInitialState(args) {
  const legGoals = args.leg_goals === void 0 ? [] : [...args.leg_goals];
  const legGoalMode = legGoals.length === 0 ? "dynamic" : "predefined";
  const pursuitId = mintPursuitId();
  const firstGoal = legGoalMode === "dynamic" ? args.pursuit_goal : legGoals[0] ?? args.pursuit_goal;
  return {
    version: 0,
    is_workflow_done: false,
    workflow_status: "running",
    pursuit: {
      id: pursuitId,
      goal: args.pursuit_goal,
      legGoalMode,
      legGoals,
      status: "Running",
      closedAt: null
    },
    legs: [
      createLeg({
        sequence: 1,
        origin: "initial",
        legGoal: firstGoal,
        legGoalProvenance: legGoalMode === "dynamic" ? "inherited from pursuit goal" : "predefined leg_goal[1]",
        isLegGoalMutatable: legGoalMode === "dynamic",
        nextLegGoal: legGoalMode === "predefined" ? legGoals[1] ?? null : null,
        maxAttempts: args.max_attempts
      })
    ],
    failures: []
  };
}
function createLeg(input) {
  const legId = randomUUID();
  return {
    id: legId,
    sequence: input.sequence,
    origin: input.origin,
    maxAttempts: input.maxAttempts,
    status: "Running",
    legGoal: input.legGoal,
    legGoalVersion: 1,
    legGoalProvenance: input.legGoalProvenance,
    isLegGoalMutatable: input.isLegGoalMutatable,
    nextLegGoal: input.nextLegGoal,
    attempts: [createAttempt(1, 1)]
  };
}
function createAttempt(sequence, legGoalVersion) {
  return {
    id: randomUUID(),
    sequence,
    status: "Running",
    failureReasons: [],
    legGoalVersion,
    isConsistentWithLegGoal: true,
    plan: {
      id: randomUUID(),
      status: "NotStarted",
      declaredLegGoal: null,
      declaredNextLegGoal: null,
      legGoalVersion,
      summary: null
    },
    workItems: []
  };
}
function plannerDispatch(state, leg, attempt, node) {
  const metadata = {
    role: "planner",
    leg_id: leg.id,
    attempt_id: attempt.id,
    plan_id: attempt.plan.id,
    attempt: attempt.sequence
  };
  return {
    start: startFor(node, metadata, {
      messages: plannerMessages(state, leg, attempt),
      args: {
        kind: "planner",
        pursuit_context: snapshotPursuitContext(state),
        current: {
          pursuit_id: state.pursuit.id,
          leg_id: leg.id,
          attempt_id: attempt.id,
          plan_id: attempt.plan.id
        }
      },
      outcome: {
        name: "submit_planner_outcome",
        description: "Submit the pursuit planner result for this attempt.",
        schema: PlannerOutcomePayloadSchema
      }
    }),
    metadata
  };
}
function workerDispatch(state, leg, attempt, item, node) {
  const metadata = {
    role: "worker",
    leg_id: leg.id,
    attempt_id: attempt.id,
    work_item_id: item.id,
    work_item_key: item.key,
    attempt: attempt.sequence
  };
  return {
    start: startFor(node, metadata, {
      messages: workerMessages(state, leg, attempt, item),
      args: {
        kind: "worker",
        pursuit_context: snapshotPursuitContext(state),
        current: {
          pursuit_id: state.pursuit.id,
          leg_id: leg.id,
          attempt_id: attempt.id,
          work_item_id: item.id
        }
      },
      outcome: {
        name: "submit_worker_outcome",
        description: "Submit the pursuit worker result for this work item.",
        schema: WorkerOutcomePayloadSchema
      }
    }),
    metadata
  };
}
function startFor(node, metadata, input) {
  if (node.kind === "agent") {
    return {
      node,
      input: {
        messages: input.messages,
        metadata
      },
      outcome: input.outcome
    };
  }
  return {
    node,
    input: {
      args: input.args,
      metadata
    },
    outcome: input.outcome
  };
}
function plannerMessages(state, leg, attempt) {
  const previousFailures = leg.attempts.filter((candidate) => candidate.status === "Failed").map((candidate) => `- attempt_${candidate.id}: ${candidate.failureReasons.map(formatAttemptFailureReason).join("; ")}`).join("\n");
  return [
    userMessage([
      "# Pursuit goal",
      state.pursuit.goal,
      "# Current leg goal",
      leg.legGoal,
      `Provenance: ${leg.legGoalProvenance}`,
      leg.nextLegGoal === null ? "" : `# Declared next leg goal
${leg.nextLegGoal}`,
      previousFailures.length === 0 ? "" : `# Failed prior attempts
${previousFailures}`,
      "# Planner task",
      `Plan attempt ${String(attempt.sequence)}. Submit work items with stable ids, titles, specs, and dependency ids. Use leg_goal only to replace a dynamic leg goal; use next_leg_goal only to queue the next dynamic leg.`
    ])
  ];
}
function workerMessages(state, leg, attempt, item) {
  const dependencies = item.dependsOn.map((id) => workItemById(leg, attempt, id)).filter((candidate) => candidate !== void 0).map((dependency) => [
    `## work_item_${dependency.id}`,
    dependency.summary ?? "(no summary)",
    dependency.outcome ?? "(no outcome)"
  ].join("\n")).join("\n\n");
  return [
    userMessage([
      "# Pursuit goal",
      state.pursuit.goal,
      "# Current leg goal",
      leg.legGoal,
      "# Work item",
      `work_item_${item.id}: ${item.title}`,
      item.spec,
      dependencies.length === 0 ? "" : `# Completed dependencies
${dependencies}`,
      "# Worker task",
      "Complete only this work item, then submit whether it passed, a concise summary, and the outcome."
    ])
  ];
}
function userMessage(sections) {
  return {
    role: "user",
    content: [
      {
        type: "text",
        text: sections.filter((section) => section.length > 0).join("\n\n")
      }
    ]
  };
}
function applyPlannerSettlement(state, metadata, settlement) {
  const next = cloneState(state);
  const located = findAttempt(next, metadata);
  if (located === void 0) return { state };
  if (settlement.status !== "completed") {
    const reason = settlementFailure(settlement, "planner");
    located.attempt.plan.status = "Failed";
    located.attempt.failureReasons = [plannerFailureReason(reason)];
    next.failures.push(reason);
    return withTransition(
      bump(next),
      "pursuit_planner_failed",
      { plan_id: metadata.plan_id, reason }
    );
  }
  const payload = PlannerOutcomePayloadSchema.parse(settlement.accepted.outcome);
  const { leg, attempt } = located;
  if (payload.leg_goal !== void 0) {
    leg.legGoalVersion += 1;
    leg.legGoal = payload.leg_goal;
    leg.legGoalProvenance = `declared by attempt_${attempt.id} planner`;
    leg.nextLegGoal = payload.next_leg_goal ?? null;
    for (const candidate of leg.attempts) {
      candidate.isConsistentWithLegGoal = candidate.id === attempt.id;
    }
    attempt.legGoalVersion = leg.legGoalVersion;
  } else if (payload.next_leg_goal !== void 0) {
    leg.nextLegGoal = payload.next_leg_goal;
  }
  attempt.plan = {
    ...attempt.plan,
    status: "Success",
    declaredLegGoal: payload.leg_goal ?? null,
    declaredNextLegGoal: payload.next_leg_goal ?? null,
    legGoalVersion: leg.legGoalVersion,
    summary: payload.summary
  };
  attempt.workItems.push(
    ...payload.work_items.map((item) => ({
      key: workItemKey(leg.id, leg.legGoalVersion, item.id),
      id: item.id,
      agentName: item.agent_name,
      status: "NotStarted",
      title: item.title,
      spec: item.spec,
      dependsOn: [...item.depends_on],
      legGoalVersion: leg.legGoalVersion,
      summary: null,
      outcome: null
    }))
  );
  return withTransition(
    bump(next),
    "pursuit_planner_submitted",
    { plan_id: metadata.plan_id, attempt: metadata.attempt }
  );
}
function applyWorkerSettlement(state, metadata, settlement) {
  const next = cloneState(state);
  const located = findWorkItem(next, metadata);
  if (located === void 0) return { state };
  const item = located.item;
  if (settlement.status !== "completed") {
    const reason = settlementFailure(settlement, "worker");
    item.status = "Failed";
    item.summary = reason;
    item.outcome = reason;
    next.failures.push(reason);
    return withTransition(
      bump(next),
      "pursuit_worker_failed",
      { work_item_id: item.id, reason }
    );
  }
  const payload = WorkerOutcomePayloadSchema.parse(settlement.accepted.outcome);
  item.status = payload.is_pass ? "Success" : "Failed";
  item.summary = payload.summary;
  item.outcome = payload.outcome;
  return withTransition(
    bump(next),
    "pursuit_worker_submitted",
    { work_item_id: item.id, status: item.status }
  );
}
function reconcilePursuitProgress(state, running) {
  if (state.is_workflow_done) return { state };
  const next = cloneState(state);
  let changed = false;
  for (const leg of next.legs) {
    if (leg.status !== "Running") continue;
    let legChanged = propagateDependencyBlocks(leg, running);
    legChanged = reconcileLeg(next, leg, running) || legChanged;
    changed = changed || legChanged;
  }
  if (!changed) return { state };
  return withTransition(
    bump(next),
    next.is_workflow_done ? "pursuit_finished" : "pursuit_progressed",
    {
      status: next.pursuit.status,
      latest_leg_id: next.legs.at(-1)?.id ?? null
    }
  );
}
function propagateDependencyBlocks(leg, running) {
  let changed = false;
  let keepGoing = true;
  while (keepGoing) {
    keepGoing = false;
    for (const attempt of leg.attempts) {
      for (const item of attempt.workItems) {
        if (item.status !== "NotStarted") continue;
        if (running.workItems.has(item.key)) continue;
        const blockedBy = item.dependsOn.filter(
          (id) => dependencyBlocks(dependencyStatus(leg, item.legGoalVersion, id))
        );
        if (blockedBy.length === 0) continue;
        const summary = blockedSummary(blockedBy);
        item.status = "Blocked";
        item.summary = summary;
        item.outcome = summary;
        changed = true;
        keepGoing = true;
      }
    }
  }
  return changed;
}
function reconcileLeg(state, leg, running) {
  const attempt = leg.attempts.at(-1);
  if (attempt === void 0 || isPursuitEntityTerminal(attempt.status)) return false;
  const failureReasons = [];
  let nextAttemptStatus;
  if (attempt.plan.status === "Failed") {
    nextAttemptStatus = "Failed";
    failureReasons.push(...attempt.failureReasons);
  } else if (attempt.plan.status === "Success" && attempt.workItems.length > 0 && attempt.workItems.every((item) => effectiveWorkItemStatus(item, running) === "Success")) {
    nextAttemptStatus = "Success";
  } else if (attempt.plan.status === "Success" && attempt.workItems.some((item) => item.status === "Failed" || item.status === "Blocked") && attempt.workItems.every((item) => isWorkItemTerminal(effectiveWorkItemStatus(item, running)))) {
    nextAttemptStatus = "Failed";
    failureReasons.push(...itemFailureReasons(attempt.workItems, leg));
  }
  if (nextAttemptStatus === void 0) return false;
  attempt.status = nextAttemptStatus;
  attempt.failureReasons = failureReasons;
  if (nextAttemptStatus === "Failed") {
    const reason = failureReasons[0]?.message ?? "attempt failed";
    state.failures.push(reason);
    if (leg.attempts.length < leg.maxAttempts) {
      leg.attempts.push(createAttempt(leg.attempts.length + 1, leg.legGoalVersion));
      return true;
    }
    leg.status = "Failed";
    closePursuit(state, "Failed");
    return true;
  }
  leg.status = "Success";
  const nextLeg = nextLegInit(state, leg);
  if (nextLeg !== null) {
    state.legs.push(createLeg(nextLeg));
    return true;
  }
  closePursuit(state, "Success");
  return true;
}
function closePursuit(state, status) {
  state.pursuit.status = status;
  state.pursuit.closedAt = (/* @__PURE__ */ new Date()).toISOString();
  state.is_workflow_done = true;
  state.workflow_status = status === "Success" ? "success" : "failure";
}
function nextLegInit(state, leg) {
  if (state.pursuit.legGoalMode === "dynamic") {
    if (leg.nextLegGoal === null) return null;
    return {
      sequence: leg.sequence + 1,
      origin: "next_leg_goal",
      legGoal: leg.nextLegGoal,
      legGoalProvenance: `inherited from successful leg_${String(leg.sequence)} next_leg_goal`,
      isLegGoalMutatable: true,
      nextLegGoal: null,
      maxAttempts: leg.maxAttempts
    };
  }
  const nextGoal = state.pursuit.legGoals.at(leg.sequence);
  if (nextGoal === void 0) return null;
  return {
    sequence: leg.sequence + 1,
    origin: "predefined",
    legGoal: nextGoal,
    legGoalProvenance: `predefined leg_goal[${String(leg.sequence + 1)}]`,
    isLegGoalMutatable: false,
    nextLegGoal: state.pursuit.legGoals[leg.sequence + 1] ?? null,
    maxAttempts: leg.maxAttempts
  };
}
function plannerSubmissionError(state, leg, attempt, payload) {
  if (state.pursuit.legGoalMode === "predefined" && (payload.leg_goal !== void 0 || payload.next_leg_goal !== void 0)) {
    return "predefined leg goals cannot be refocused or declare next_leg_goal";
  }
  const currentIds = /* @__PURE__ */ new Set();
  for (const item of payload.work_items) {
    if (currentIds.has(item.id)) return `duplicate work item id "${item.id}"`;
    currentIds.add(item.id);
  }
  const allExisting = leg.attempts.flatMap(
    (candidateAttempt) => candidateAttempt.workItems.map((item) => ({
      attempt: candidateAttempt,
      item
    }))
  );
  const existingInVersion = allExisting.filter(
    (entry) => entry.attempt.isConsistentWithLegGoal && entry.item.legGoalVersion === leg.legGoalVersion
  );
  if (payload.leg_goal === void 0) {
    for (const item of payload.work_items) {
      if (existingInVersion.some((entry) => entry.item.id === item.id)) {
        return `duplicate work item id "${item.id}" in current leg goal version`;
      }
    }
  }
  for (const item of payload.work_items) {
    for (const dependency of item.depends_on) {
      if (currentIds.has(dependency)) continue;
      if (payload.leg_goal !== void 0) {
        return "replacement leg_goal submissions cannot depend_on prior work items";
      }
      const matching = allExisting.filter((entry) => entry.item.id === dependency);
      if (matching.length === 0) {
        return `work item "${item.id}" depends_on unknown id "${dependency}"`;
      }
      const existing = matching.find(
        (entry) => entry.attempt.sequence < attempt.sequence && entry.attempt.isConsistentWithLegGoal && entry.item.legGoalVersion === leg.legGoalVersion
      );
      if (existing) continue;
      const first = matching[0];
      if (first.attempt.sequence >= attempt.sequence) {
        return `work item "${item.id}" depends_on future attempt item "${dependency}"`;
      }
      return `work item "${item.id}" depends_on superseded leg-goal version item "${dependency}"`;
    }
  }
  return currentGraphCycle(payload);
}
function currentGraphCycle(payload) {
  const ids = new Set(payload.work_items.map((item) => item.id));
  const graph = new Map(
    payload.work_items.map((item) => [
      item.id,
      item.depends_on.filter((dependency) => ids.has(dependency))
    ])
  );
  const done = /* @__PURE__ */ new Set();
  const visiting = /* @__PURE__ */ new Set();
  const hasCycle = (id) => {
    if (done.has(id)) return false;
    if (visiting.has(id)) return true;
    visiting.add(id);
    for (const dependency of graph.get(id) ?? []) {
      if (hasCycle(dependency)) return true;
    }
    visiting.delete(id);
    done.add(id);
    return false;
  };
  for (const id of graph.keys()) {
    if (hasCycle(id)) return "work item depends_on contains a dependency cycle";
  }
  return void 0;
}
function bindingFor(definition, role) {
  const bindings = definition.metadata?.nodeBindings;
  if (!isBindingMap(bindings)) return void 0;
  return bindings[role];
}
function isBindingMap(value) {
  if (typeof value !== "object" || value === null) return false;
  const bindings = value;
  return isBinding(bindings.planner) && isBinding(bindings.worker);
}
function isBinding(value) {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value;
  return (candidate.kind === "agent" || candidate.kind === "workflow") && typeof candidate.name === "string";
}
function settlementMetadata(settlement) {
  const metadata = settlement.status === "completed" ? settlement.accepted.metadata : settlement.metadata;
  if (metadata === void 0) return void 0;
  const candidate = metadata;
  if (candidate.role === "planner" && typeof candidate.leg_id === "string" && typeof candidate.attempt_id === "string" && typeof candidate.plan_id === "string" && typeof candidate.attempt === "number") {
    return {
      role: "planner",
      leg_id: candidate.leg_id,
      attempt_id: candidate.attempt_id,
      plan_id: candidate.plan_id,
      attempt: candidate.attempt
    };
  }
  if (candidate.role === "worker" && typeof candidate.leg_id === "string" && typeof candidate.attempt_id === "string" && typeof candidate.work_item_id === "string" && typeof candidate.work_item_key === "string" && typeof candidate.attempt === "number") {
    return {
      role: "worker",
      leg_id: candidate.leg_id,
      attempt_id: candidate.attempt_id,
      work_item_id: candidate.work_item_id,
      work_item_key: candidate.work_item_key,
      attempt: candidate.attempt
    };
  }
  return void 0;
}
function settlementFailure(settlement, role) {
  if (settlement.status === "completed") return `${role} completed`;
  if (settlement.status === "cancelled") return `${role} cancelled: ${settlement.reason ?? "cancelled"}`;
  return `${role} ${settlement.status}: ${settlement.reason}`;
}
function findAttempt(state, metadata) {
  const leg = state.legs.find((candidate) => candidate.id === metadata.leg_id);
  const attempt = leg?.attempts.find((candidate) => candidate.id === metadata.attempt_id);
  return leg !== void 0 && attempt !== void 0 ? { leg, attempt } : void 0;
}
function findWorkItem(state, metadata) {
  const located = findAttempt(state, metadata);
  const item = located?.attempt.workItems.find(
    (candidate) => candidate.id === metadata.work_item_id && candidate.key === metadata.work_item_key
  );
  return located !== void 0 && item !== void 0 ? { ...located, item } : void 0;
}
function runningMetadata(runtime) {
  const plans = /* @__PURE__ */ new Set();
  const workItems = /* @__PURE__ */ new Set();
  for (const node of runtime.runningNodes) {
    const metadata = node.metadata;
    if (metadata?.role === "planner" && typeof metadata.plan_id === "string") {
      plans.add(metadata.plan_id);
    }
    if (metadata?.role === "worker" && typeof metadata.work_item_key === "string") {
      workItems.add(metadata.work_item_key);
    }
  }
  return { plans, workItems };
}
function dependenciesSucceeded(leg, item) {
  return item.dependsOn.every(
    (id) => dependencyStatus(leg, item.legGoalVersion, id) === "Success"
  );
}
function dependencyStatus(leg, legGoalVersion, id) {
  return leg.attempts.flatMap((attempt) => attempt.workItems).find((item) => item.id === id && item.legGoalVersion === legGoalVersion)?.status;
}
function dependencyBlocks(status) {
  return status === "Failed" || status === "Blocked";
}
function effectiveWorkItemStatus(item, running) {
  return item.status === "NotStarted" && running.workItems.has(item.key) ? "Running" : item.status;
}
function itemFailureReasons(items, leg) {
  return items.filter((item) => item.status === "Failed" || item.status === "Blocked").map((item) => {
    if (item.status === "Blocked") {
      const blockedBy = item.dependsOn.filter(
        (id) => dependencyBlocks(dependencyStatus(leg, item.legGoalVersion, id))
      );
      return {
        work_item_id: item.id,
        kind: "blocked_by_failed_dependency",
        message: blockedBy.length > 0 ? blockedSummary(blockedBy) : null,
        summary: item.summary,
        outcome: item.outcome,
        ...blockedBy.length > 0 && { blocked_by: blockedBy }
      };
    }
    return {
      work_item_id: item.id,
      kind: "failed",
      message: null,
      summary: item.summary,
      outcome: item.outcome
    };
  });
}
function plannerFailureReason(message) {
  return {
    work_item_id: null,
    kind: message.startsWith("context_script_error:") ? "context_composition_failed" : "planner_failed",
    message,
    summary: null,
    outcome: null
  };
}
function blockedSummary(blockedBy) {
  return `blocked by ${blockedBy.map((id) => `work_item_${id}`).join(", ")}`;
}
function workItemById(leg, attempt, id) {
  return leg.attempts.filter((candidate) => candidate.sequence <= attempt.sequence).flatMap((candidate) => candidate.workItems).find((item) => item.id === id && item.status === "Success");
}
function workItemKey(legId, legGoalVersion, itemId) {
  return `${legId}:${String(legGoalVersion)}:${itemId}`;
}
function cloneState(state) {
  return {
    ...state,
    pursuit: { ...state.pursuit, legGoals: [...state.pursuit.legGoals] },
    failures: [...state.failures],
    ...state.last_transition !== void 0 && {
      last_transition: { ...state.last_transition }
    },
    ...state.last_dispatch !== void 0 && {
      last_dispatch: {
        ...state.last_dispatch,
        nodeNames: [...state.last_dispatch.nodeNames]
      }
    },
    legs: state.legs.map((leg) => ({
      ...leg,
      attempts: leg.attempts.map((attempt) => ({
        ...attempt,
        failureReasons: attempt.failureReasons.map((reason) => ({
          ...reason,
          ...reason.blocked_by !== void 0 && {
            blocked_by: [...reason.blocked_by]
          }
        })),
        plan: { ...attempt.plan },
        workItems: attempt.workItems.map((item) => ({
          ...item,
          dependsOn: [...item.dependsOn]
        }))
      }))
    }))
  };
}
function bump(state) {
  return { ...state, version: state.version + 1 };
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
  const summary = terminalSummary(state);
  if (state.workflow_status === "success") {
    return {
      status: "success",
      output: {
        pursuit_id: state.pursuit.id,
        context_path: pursuitRootPath(state.pursuit.id),
        summary
      }
    };
  }
  return {
    status: "failure",
    reason: summary,
    output: {
      pursuit_id: state.pursuit.id,
      context_path: pursuitRootPath(state.pursuit.id),
      failures: state.failures
    }
  };
}
function terminalSummary(state) {
  if (state.pursuit.status === "Success") {
    return state.legs.at(-1)?.attempts.at(-1)?.plan.summary ?? "pursuit completed";
  }
  const reasons = [...state.legs].reverse().flatMap((leg) => [...leg.attempts].reverse()).find((attempt) => attempt.failureReasons.length > 0)?.failureReasons;
  return reasons?.[0] ? formatAttemptFailureReason(reasons[0]) : "pursuit failed";
}
function snapshotPursuitContext(state) {
  return {
    pursuit: {
      id: state.pursuit.id,
      goal: state.pursuit.goal,
      leg_goal_mode: state.pursuit.legGoalMode,
      predefined_leg_count: state.pursuit.legGoalMode === "predefined" ? state.pursuit.legGoals.length : null,
      status: state.pursuit.status,
      context_path: pursuitRootPath(state.pursuit.id),
      outcome: isPursuitEntityTerminal(state.pursuit.status) ? terminalSummary(state) : null,
      legs: state.legs.map((leg) => snapshotLeg(state, leg))
    }
  };
}
function snapshotLeg(state, leg) {
  const root = pursuitRootPath(state.pursuit.id);
  return {
    id: leg.id,
    sequence: leg.sequence,
    origin: leg.origin,
    status: leg.status,
    leg_goal: leg.legGoal,
    leg_goal_version: leg.legGoalVersion,
    leg_goal_provenance: leg.legGoalProvenance,
    is_leg_goal_mutatable: leg.isLegGoalMutatable,
    next_leg_goal: leg.nextLegGoal,
    max_attempts: leg.maxAttempts,
    context_path: `${root}/${legDirName(leg.id)}`,
    outcome: isPursuitEntityTerminal(leg.status) ? composeLegOutcome(leg) : null,
    attempts: leg.attempts.map((attempt) => snapshotAttempt(root, leg, attempt))
  };
}
function snapshotAttempt(root, leg, attempt) {
  const contextPath = `${root}/${attemptDirPath(leg, attempt)}`;
  return {
    id: attempt.id,
    sequence: attempt.sequence,
    status: attempt.status,
    failure_reasons: attempt.failureReasons,
    is_consistent_with_leg_goal: attempt.isConsistentWithLegGoal,
    context_path: contextPath,
    outcome: isPursuitEntityTerminal(attempt.status) ? composeAttemptOutcome(attempt) : null,
    leg_goal_version: attempt.legGoalVersion,
    plan: {
      id: attempt.plan.id,
      status: attempt.plan.status,
      declared_leg_goal: attempt.plan.declaredLegGoal,
      declared_next_leg_goal: attempt.plan.declaredNextLegGoal,
      summary: attempt.plan.summary,
      agent_run_id: null,
      leg_goal_version: attempt.plan.legGoalVersion
    },
    work_items: attempt.workItems.map((item) => ({
      id: item.id,
      agent_name: item.agentName,
      title: item.title,
      spec: item.spec,
      depends_on: item.dependsOn,
      status: item.status,
      summary: item.summary,
      outcome: item.outcome,
      agent_run_id: null,
      context_path: `${contextPath}/work_item_${item.id}`,
      leg_goal_version: item.legGoalVersion
    }))
  };
}
function buildPursuitContext(state, running = {
  plans: /* @__PURE__ */ new Set(),
  workItems: /* @__PURE__ */ new Set()
}) {
  const files = /* @__PURE__ */ new Map();
  const directories = /* @__PURE__ */ new Map();
  const pursuitRef = {
    kind: "pursuit",
    id: state.pursuit.id,
    status: state.pursuit.status,
    summaryFirstLine: null
  };
  directories.set("", { owner: pursuitRef, superseded: false });
  files.set("goal.md", { owner: pursuitRef, content: state.pursuit.goal });
  if (isPursuitEntityTerminal(state.pursuit.status)) {
    files.set("outcome.md", { owner: pursuitRef, content: composePursuitOutcome(state) });
  }
  for (const leg of state.legs) {
    const legDir = legDirName(leg.id);
    const legRef = {
      kind: "leg",
      id: leg.id,
      status: leg.status,
      summaryFirstLine: null
    };
    directories.set(legDir, { owner: legRef, superseded: false });
    files.set(`${legDir}/leg_goal.md`, {
      owner: legRef,
      content: `${leg.legGoal}

Provenance: ${leg.legGoalProvenance}`
    });
    if (leg.nextLegGoal !== null) {
      files.set(`${legDir}/next_leg_goal.md`, {
        owner: legRef,
        content: leg.nextLegGoal
      });
    }
    if (isPursuitEntityTerminal(leg.status)) {
      files.set(`${legDir}/outcome.md`, { owner: legRef, content: composeLegOutcome(leg) });
    }
    for (const attempt of leg.attempts) {
      const superseded = !attempt.isConsistentWithLegGoal;
      const attemptDir = attemptDirPath(leg, attempt);
      const attemptStatus = attempt.status === "Running" && running.plans.has(attempt.plan.id) ? "Running" : attempt.status;
      const attemptRef = {
        kind: "attempt",
        id: attempt.id,
        status: attemptStatus,
        summaryFirstLine: firstLine(attempt.plan.summary)
      };
      if (superseded) {
        directories.set(`${legDir}/superseded`, {
          owner: legRef,
          superseded: true
        });
      }
      directories.set(attemptDir, { owner: attemptRef, superseded });
      for (const file of attemptFieldFiles(attempt)) {
        files.set(`${attemptDir}/${file.name}`, {
          owner: attemptRef,
          content: file.content
        });
      }
      if (superseded) {
        for (const file of supersededDeclarationFiles(attempt)) {
          files.set(`${attemptDir}/${file.name}`, {
            owner: attemptRef,
            content: file.content
          });
        }
      }
      for (const item of attempt.workItems) {
        const itemRef = {
          kind: "work_item",
          id: item.id,
          status: effectiveWorkItemStatus(item, running),
          summaryFirstLine: firstLine(item.summary)
        };
        const itemDir = `${attemptDir}/work_item_${item.id}`;
        directories.set(itemDir, { owner: itemRef, superseded });
        for (const file of workItemFieldFiles(item)) {
          files.set(`${itemDir}/${file.name}`, {
            owner: itemRef,
            content: file.content
          });
        }
      }
    }
  }
  return {
    pursuitId: state.pursuit.id,
    rootPath: pursuitRootPath(state.pursuit.id),
    latestLegId: state.legs.at(-1)?.id ?? null,
    files,
    directories
  };
}
async function contextForWorkflowRun(handles, workflowRecordId, readLatestSnapshot) {
  const handle = handles.get(workflowRecordId);
  const snapshot = handle === void 0 ? await readLatestSnapshot?.({ workflowRunId: workflowRecordId }) : handle.snapshot();
  if (snapshot === void 0) return void 0;
  const state = pursuitStateFromSnapshot(snapshot.state);
  if (state === void 0) return void 0;
  return buildPursuitContext(state, runningMetadata(snapshot));
}
function pursuitStateFromSnapshot(state) {
  if (!("pursuit" in state) || !("legs" in state) || !("failures" in state)) {
    return void 0;
  }
  return state;
}
function listContextRows(context) {
  const rows = [];
  for (const [path, entry] of context.directories) {
    rows.push({
      kind: "directory",
      path: path.length === 0 ? context.rootPath : `${context.rootPath}/${path}`,
      status: entry.owner.status,
      owner_kind: entry.owner.kind,
      owner_id: entry.owner.id,
      superseded: entry.superseded
    });
  }
  for (const [path, entry] of context.files) {
    rows.push({
      kind: "file",
      path: `${context.rootPath}/${path}`,
      status: entry.owner.status,
      owner_kind: entry.owner.kind,
      owner_id: entry.owner.id,
      bytes: entry.content.length
    });
  }
  return rows.sort((left, right) => stringField(left, "path").localeCompare(stringField(right, "path")));
}
function searchContextRows(context, query) {
  const normalized = query.toLocaleLowerCase();
  const results = [];
  for (const [path, entry] of context.files) {
    const index = entry.content.toLocaleLowerCase().indexOf(normalized);
    if (index < 0) continue;
    const start = Math.max(0, index - CONTEXT_SNIPPET_RADIUS);
    const end = Math.min(entry.content.length, index + query.length + CONTEXT_SNIPPET_RADIUS);
    results.push({
      path: `${context.rootPath}/${path}`,
      status: entry.owner.status,
      owner_kind: entry.owner.kind,
      owner_id: entry.owner.id,
      snippet: entry.content.slice(start, end)
    });
  }
  return results;
}
function attemptFieldFiles(attempt) {
  const files = [];
  if (attempt.plan.summary !== null) {
    files.push({ name: "plan_summary.md", content: attempt.plan.summary });
  }
  if (attempt.status === "Failed" && attempt.failureReasons.length > 0) {
    files.push({
      name: "failure_reasons.md",
      content: attempt.failureReasons.map((reason) => `- ${formatAttemptFailureReason(reason)}`).join("\n")
    });
  }
  if (attempt.status === "Success" || attempt.status === "Failed") {
    files.push({ name: "outcome.md", content: composeAttemptOutcome(attempt) });
  }
  return files;
}
function workItemFieldFiles(item) {
  const files = [
    { name: "title.md", content: item.title },
    { name: "spec.md", content: item.spec }
  ];
  if (item.summary !== null) files.push({ name: "summary.md", content: item.summary });
  if (item.outcome !== null) files.push({ name: "outcome.md", content: item.outcome });
  return files;
}
function supersededDeclarationFiles(attempt) {
  const files = [];
  if (attempt.plan.declaredLegGoal !== null) {
    files.push({ name: "leg_goal.md", content: attempt.plan.declaredLegGoal });
  }
  if (attempt.plan.declaredNextLegGoal !== null) {
    files.push({ name: "next_leg_goal.md", content: attempt.plan.declaredNextLegGoal });
  }
  return files;
}
function composePursuitOutcome(state) {
  const head = state.pursuit.status === "Cancelled" ? "# Pursuit outcome\npursuit cancelled" : "# Pursuit outcome";
  const sections = state.legs.filter((leg) => leg.status === "Success" || leg.status === "Failed").map((leg) => `## leg_${leg.id} [${leg.status}]
${composeLegOutcome(leg)}`);
  return [head, ...sections].join("\n\n");
}
function composeLegOutcome(leg) {
  const attempt = leg.attempts.at(-1);
  return attempt ? composeAttemptOutcome(attempt) : "(no attempts)";
}
function composeAttemptOutcome(attempt) {
  if (attempt.workItems.length === 0) return "# Attempt outcome\n(no work items)";
  const rows = attempt.workItems.map(
    (item) => `- work_item_${item.id} [${item.status}]: ${item.summary ?? "(no summary)"}`
  );
  return ["# Attempt outcome", ...rows].join("\n");
}
function formatAttemptFailureReason(reason) {
  if (reason.kind === "failed" && reason.work_item_id !== null) {
    return `work_item_${reason.work_item_id} [Failed]: ${reason.summary ?? reason.outcome ?? reason.message ?? "(no summary)"}`;
  }
  if (reason.kind === "blocked_by_failed_dependency" && reason.work_item_id !== null) {
    return `work_item_${reason.work_item_id} [Blocked]: ${reason.summary ?? reason.message ?? blockedByText(reason.blocked_by)}`;
  }
  if (reason.kind === "context_composition_failed") {
    if (reason.work_item_id !== null) {
      return `work_item_${reason.work_item_id} [Context composition failed]: ${reason.message ?? "(no message)"}`;
    }
    return `planner [Context composition failed]: ${reason.message ?? "(no message)"}`;
  }
  return `planner [Failed]: ${reason.message ?? "(no message)"}`;
}
function blockedByText(blockedBy) {
  if (blockedBy === void 0 || blockedBy.length === 0) {
    return "blocked by failed dependency";
  }
  return `blocked by ${blockedBy.map((id) => `work_item_${id}`).join(", ")}`;
}
function pursuitRootPath(pursuitId) {
  return `pursuit_${pursuitId}`;
}
function legDirName(legId) {
  return `leg_${legId}`;
}
function attemptDirPath(leg, attempt) {
  const base = legDirName(leg.id);
  return attempt.isConsistentWithLegGoal ? `${base}/attempt_${attempt.id}` : `${base}/superseded/attempt_${attempt.id}`;
}
function firstLine(text) {
  if (text === null) return null;
  return text.split("\n", 1)[0] ?? text;
}
function stringField(value, key) {
  const field = value[key];
  return typeof field === "string" ? field : "";
}
export {
  AttemptFailureReasonSchema,
  CreatePursuitInputSchema,
  PlannerOutcomePayloadSchema,
  PursuitEntityRunStatusSchema,
  WorkItemRunStatusSchema,
  WorkerOutcomePayloadSchema,
  createPursuitContextStore,
  isPursuitEntityTerminal,
  isWorkItemTerminal,
  mintPursuitId,
  pursuitIdFrom,
  pursuitModule,
  workItemIdFrom
};
export default defineAgenticWorkflow(pursuitModule);
export const createContextStore = createPursuitContextStore;
