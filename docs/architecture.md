# Ephemeral Agent: Multi-Agent Coordination Architecture

A technical vision document describing the three-tier hierarchical multi-agent system for autonomous agent swarm orchestration.

> [!NOTE]
> This document outlines the architectural framework for Ephemeral Agent — transforming the abstract concept of multi-agent coordination into a concrete implementation that embodies our core philosophy: **intelligence is fluid, scalable, and leaves no residual overhead.**

---

## Core Philosophy

> **State lives in the stores, not in the agents.**

Every agent is disposable. Every component can crash and be restarted. The system re-derives its state from persistent data stores. This is the foundation of ephemeral computing — infinite scalability with zero idle compute cost.

---

## Layer 0: The Data Stores

All coordination happens through shared data stores, not direct messaging. This ensures traceability, auditability, and system resilience.

### 0.1 Taskboard

A persistent store that tracks all coordination work items. Each record is a **Task Item**:

| Field | Type | Description |
|---|---|---|
| `id` | `UUID` | Unique identifier |
| `phase_id` | `str` | Which orchestration phase this belongs to |
| `title` | `str` | Human-readable task title |
| `description` | `str` | Full task description with acceptance criteria |
| `status` | `enum` | `open → doing → done` state machine |
| `claimed_by` | `Agent ID` | Team Leader that owns this task |
| `depends_on` | `list[UUID]` | Tasks that must complete first |
| `interface_contracts` | `JSON` | Shared API/data contracts between tasks |
| `acceptance_criteria` | `str` | What defines "done" |

**Critical behavior:** The `claim` operation atomically checks:
1. All dependent tasks are `done`
2. No other Team Leader has claimed it

### 0.2 Context Store

A key-value store where entries are tagged with `task_id` and `phase`. Holds:
- Decisions
- Artifacts
- Assumptions
- Interface contracts
- Open questions

| Field | Type | Description |
|---|---|---|
| `id` | `UUID` | Unique identifier |
| `task_id` | `UUID` | Which task produced this |
| `phase` | `str` | Phase identifier |
| `entry_type` | `enum` | `decision`, `artifact`, `assumption`, `contract`, `question` |
| `content` | `text` | The actual content (markdown/JSON) |
| `created_by` | `Agent ID` | Agent or leader ID |

### 0.3 Session History Store

Tracks the immutable log of every agent execution. Even as agents vaporize, their insights are preserved for future swarms.

Extends with:
- `parent_task_id` — links ephemeral agent sessions to Taskboard tasks
- `spawned_by` — Team Leader ID for hierarchy tracking
- `subtask_description` — assigned subtask context

---

## Layer 1: Ephemeral Agents

The simplest actors — they receive instructions, execute, write outputs, and terminate. This is the foundation of infinite scalability.

### 1.1 Spawning Contract

Every ephemeral agent is spawned with a well-defined contract:

```python
@dataclass
class SpawningContract:
    """All inputs needed to spawn a coordinated ephemeral agent."""
    subtask_description: str
    agent_role: str           # "executor" or "observer"
    agent_name: str           # which specialist to use
    context_slice: list[dict] # relevant contracts, prior history, artifacts
    parent_task_id: str       # links back to Taskboard
    spawned_by: str           # Team Leader ID
    timeout_seconds: int = 300
```

### 1.2 Agent Types

**Executor Agent**
- Receives write access to the Context Store
- Produces code, configs, documents
- System prompt includes subtask and relevant context slice

**Observer Agent**
- Read-only access to another agent's session history
- Produces structured summaries
- Cannot write artifacts — only observes and reports

### 1.3 Hard Boundaries

The critical design constraint: agents **cannot** spawn other agents, **cannot** read the Taskboard, and **cannot** communicate except through:
- The Context Store (shared knowledge)
- Their own session history (immutable logs)

This isolation ensures:
- No unauthorized agent proliferation
- Complete audit trail
- Deterministic system behavior

---

## Layer 2: Team Leaders

A Team Leader is a long-running agent loop that coordinates a group of ephemeral agents around a claimed task.

### 2.1 Capability Profile and Task Claiming

```python
@dataclass
class TeamLeaderProfile:
    leader_id: str
    capabilities: list[str]  # e.g. ["backend", "api", "auth"]
    agent_types: list[str]   # e.g. ["executor", "observer"]

class TeamLeader:
    async def claim_available_task(self) -> dict | None:
        """Scan taskboard for open tasks matching capabilities."""
        open_tasks = self.taskboard.list_tasks(status="open")
        for task in open_tasks:
            if self._matches_capabilities(task):
                if self.taskboard.claim_task(task["id"], self.profile.leader_id):
                    return task
        return None
```

**Claiming arbitration:** First writer wins. The Orchestrator's arbitration (Layer 3) provides smarter allocation later.

### 2.2 Subtask Decomposition

Once a Team Leader claims a task, it uses LLM reasoning to decompose it into a subtask plan:

```python
@dataclass
class SubtaskPlan:
    subtasks: list["Subtask"]

@dataclass
class Subtask:
    description: str
    agent_type: str        # "executor" or "observer"
    agent_name: str         # which specialist to spawn
    sequencing: str         # "SEQ" (sequential), "PAR" (parallel), "MILESTONE"
    depends_on: list[str]  # subtask IDs within this plan
```

### 2.3 The Execution Loop

The Team Leader walks the subtask plan, spawning agents according to the DAG:

```python
async def execute_plan(self, plan: SubtaskPlan) -> None:
    for subtask in plan.subtasks:
        if subtask.sequencing == "PAR":
            # Spawn concurrently
            parallel_tasks.append(self._spawn_agent(subtask))
        elif subtask.sequencing == "SEQ":
            await asyncio.gather(*parallel_tasks)
            parallel_tasks = []
            await self._spawn_agent(subtask)
        elif subtask.sequencing == "MILESTONE":
            await asyncio.gather(*parallel_tasks)
            parallel_tasks = []
            summary = await self._spawn_observer(subtask)
            if not self._should_continue(summary):
                await self._revise_plan(summary)
```

### 2.4 Progress Observation (Indirect Pattern)

When checking on completed subtasks, the Team Leader **never** inspects agents directly. Instead, it spawns a new observer agent to review the session history.

### 2.5 Lateral Coordination

Team Leaders coordinate through the Context Store:

```python
# Leader A posts a question
context.put(
    task_id="task-frontend",
    phase="implementation",
    entry_type="question",
    content="Need the API contract for POST /auth/login — response shape?",
    created_by="leader-frontend",
)

# Leader B responds with contract
context.put(
    task_id="task-backend",
    phase="implementation",
    entry_type="contract",
    content='{"endpoint": "POST /auth/login", "response": {"token": "string"}}',
    created_by="leader-backend",
)
```

### 2.6 Task Completion

Once all subtasks are done and an observer confirms quality:

```python
async def finalize_task(self) -> None:
    summary = await self._spawn_observer(final_review_subtask)
    if self._is_satisfactory(summary):
        self.taskboard.complete_task(self.current_task["id"])
    else:
        # Create remediation subtasks and re-enter execution loop
        ...
```

---

## Layer 3: The Orchestrator

The top of the stack — coordinates phases, manages phase gates, and handles conflict arbitration.

### 3.1 Phase Decomposition

Given a client goal (e.g., "build a user authentication system"), the Orchestrator:

1. Breaks it into sequential **phases** (Foundation → Implementation → Hardening)
2. Each phase becomes a group of **Task Items** on the Taskboard
3. Defines `acceptance_criteria`, `depends_on` links, and `interface_contracts`

**Granularity rule:** Each task = one independently testable unit. A fullstack feature → at least two tasks (frontend + backend) with a shared interface contract.

### 3.2 Phase Gate

The Orchestrator's core control mechanism:

```python
async def run_phase_gate(self, phase_id: str) -> Literal["PASS", "FIX", "REVISE"]:
    status = self.taskboard.get_phase_status(phase_id)

    if not all(t["status"] == "done" for t in status["tasks"]):
        return "FIX"

    review = await self._review_phase_outputs(phase_id)

    if review["interfaces_aligned"] and review["acceptance_met"]:
        return "PASS"
    elif review["needs_remediation"]:
        return "FIX"
    else:
        return "REVISE"
```

### 3.3 Conflict Arbitration

- **Claim contention:** Score candidates on capability fit, current workload, context continuity
- **Interface disputes:** Review proposals against Context Store and make binding decisions

### 3.4 Adaptive Re-planning

Based on phase outcomes, the Orchestrator can add, remove, or reorder tasks in future phases using the Context Store as feedback.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    ORCHESTRATION LAYER                       │
│  ┌─────────────┐  ┌─────────────┐                            │
│  │  Orchestrator │  │ Team Leader │  ┌─────────────┐       │
│  │   (Phase     │  │  (Task      │  │ Team Leader │       │
│  │  Management) │  │  Coordination) │ │  (Task      │       │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘       │
└─────────┼────────────────┼────────────────┼────────────────┘
          │                │                │
┌─────────┼────────────────┼────────────────┼────────────────┐
│         ▼                ▼                ▼                │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              TASKBOARD (Coordination)               │   │
│  │  • Task state   • Dependencies   • Claims           │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              CONTEXT STORE (Shared Knowledge)        │   │
│  │  • Decisions   • Contracts   • Artifacts            │   │
│  └─────────────────────────────────────────────────────┘   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │           SESSION HISTORY (Immutable Logs)          │   │
│  │  • Execution traces   • Results   • Observations    │   │
│  └─────────────────────────────────────────────────────┘   │
│                      DATA LAYER                              │
└─────────────────────────────────────────────────────────────┘
          │                │                │
          ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────┐
│                    EPHEMERAL AGENTS                         │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐       │
│  │Executor │  │Executor │  │Observer │  │Executor │       │
│  │ Agent   │  │ Agent   │  │ Agent   │  │ Agent   │       │
│  └─────────┘  └─────────┘  └─────────┘  └─────────┘       │
│                    (Spawned on demand, killed when done)     │
└─────────────────────────────────────────────────────────────┘
```

---

## Key Design Principles

### 1. Ephemeralism
Agents are spawned to perform highly specific tasks and killed immediately when finished. Infinite scalability with zero idle compute cost.

### 2. Persistent Agent State
Agents leave their immutable log, finalize their work securely, and vaporize from the world, leaving behind only the intelligence needed.

### 3. Agent Swarm Collaboration
Orchestrate thousands of ephemeral agents simultaneously. They communicate, coordinate, and collapse back into the void when the mission is accomplished.

### 4. Contextual Intelligence
Transforms unstructured multimodal data into structured context, enabling agents to act with pinpoint accuracy.

### 5. Distributed Execution
Low-latency, privacy-preserving task execution across global edge networks or secure local environments.

---

## Implementation Roadmap

### Phase 1: Foundation
- [ ] Taskboard store implementation
- [ ] Context store implementation
- [ ] Session history extensions

### Phase 2: Agent Layer
- [ ] Spawning contract wrapper
- [ ] Executor agent spec
- [ ] Observer agent spec
- [ ] Hard boundary enforcement

### Phase 3: Team Leader
- [ ] Team Leader profile and task claiming
- [ ] Subtask decomposition logic
- [ ] Execution loop implementation
- [ ] Progress observation pattern

### Phase 4: Orchestrator
- [ ] Phase decomposition
- [ ] Phase gate implementation
- [ ] Conflict arbitration
- [ ] Adaptive re-planning

---

## Summary

The Ephemeral Agent architecture embodies the principle that **intelligence is fluid, scalable, and leaves no residual overhead**. By separating:

- **State** (what persists) from **Agents** (what executes)
- **Coordination** (Team Leaders/Orchestrator) from **Execution** (Ephemeral Agents)
- **Communication** (Context Store) from **Computation** (Agents)

We achieve a system that can scale infinitely, recover from any failure, and deliver autonomous agent swarms that appear when needed and vanish when complete.
