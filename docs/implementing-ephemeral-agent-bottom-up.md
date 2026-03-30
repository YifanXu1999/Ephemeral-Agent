# Implementing Ephemeral Agent: Bottom Up

This document turns the Ephemeral Agent landing page into a buildable system design.

The main simplification is intentional: the MVP does not need a large multi-layer swarm architecture. It needs three things that work together reliably:

1. a durable state layer
2. a controller that creates and tracks work
3. an ephemeral worker runtime that executes and disappears

Everything else, including richer retrieval and distributed placement, should be added only after that loop is stable.

## Core Rule

Ephemeral Agent should be designed around one rule:

**execution is temporary, system memory is durable.**

If a worker can terminate and the platform can still explain what it was asked to do, what happened, what it produced, and what should happen next, the design is correct.

## What the Product Actually Promises

The landing page implies a specific architecture:

| Product claim | Minimal technical meaning |
| --- | --- |
| Ephemeral agents | Workers run inside a bounded session and are terminated after completion or timeout. |
| Persistent state | Outputs, events, and decisions are written before the worker disappears. |
| Swarm collaboration | A controller breaks an objective into tasks and passes results forward through shared state. |
| Contextual intelligence | Workers receive a selected slice of prior state, not the whole system history. |
| Distributed execution | The same worker contract can later run locally or remotely. |

The MVP should implement only the minimum required to make those claims true.

## The Simplest Viable Architecture

### 1. Durable State Layer

Start with storage, not agent behavior.

The system needs four durable records:

- `objective`: the user request and top-level status
- `task`: a unit of work with dependencies and acceptance criteria
- `session`: one worker run, including timeline, tool calls, outputs, and termination reason
- `artifact`: large outputs such as files, reports, screenshots, or patches

That is enough for the first version. A separate, sophisticated memory model is optional later.

For MVP, task state can stay simple:

`queued -> running -> completed | failed | canceled`

Two constraints matter immediately:

- task claiming must be atomic
- session writes must survive both success and failure

### 2. Controller

The controller is the only component that coordinates work.

Its job is simple:

1. accept an objective
2. create a small task graph
3. find tasks whose dependencies are satisfied
4. spawn a worker for each ready task
5. persist the result
6. schedule follow-up work if needed

The important simplification is this: workers do not coordinate with each other directly. They communicate only by writing durable outputs that the controller can pass to later tasks.

For MVP, the controller only needs to support a small DAG, not a general planning engine.

Each task should define:

- `goal`
- `role`
- `dependencies`
- `expected_output`
- `acceptance_criteria`

### 3. Ephemeral Worker Runtime

Each worker should run from a single spawn contract:

- `objective`
- `task`
- `role`
- `instructions`
- `context`
- `available_tools`
- `artifact_refs`
- `time_budget_ms`
- `output_schema`

The runtime only needs to do five things:

1. create the execution environment
2. inject instructions and context
3. run the model and tool loop
4. stream events into the session record
5. terminate on completion, timeout, or policy violation

Workers should not:

- spawn other workers
- update task state directly
- keep hidden state outside the session record
- exchange freeform messages with other workers

That keeps the system inspectable and reproducible.

## Context Without Overbuilding It

The earlier version of this design treated context as its own major subsystem. That is more than the MVP needs.

Start with a small `context_entry` table or collection:

- `scope`: objective, task, global
- `type`: requirement, decision, summary, artifact_ref, evaluation
- `content`
- `created_by`
- `created_at`

Use it for only three things:

- storing condensed task outputs
- recording important decisions
- passing summaries into downstream tasks

This gives the system reusable memory without forcing an early ontology, vector platform, or multimodal pipeline.

Retrieval in the MVP can be deterministic:

- include the objective
- include direct dependency outputs
- include explicitly linked summaries
- include referenced artifacts

If later versions need search, embeddings, or multimodal ingestion, add them after the core loop works.

## Recommended Worker Roles

Do not start with many agent types.

The first version only needs:

- `executor`: performs the task
- `reviewer`: checks the output and decides accept or retry
- `summarizer`: compresses finished work into reusable context

That supports execution, quality control, and memory compaction without role sprawl.

## What To Delay

These ideas are valid, but they should not be part of the initial design:

- direct agent-to-agent chat
- a complex planner with many specialized roles
- a full retrieval or vector-memory platform
- market-style scheduling or dynamic arbitration
- true distributed placement across local, cloud, and edge nodes

The project should first prove one narrow claim: disposable workers can produce durable, reviewable progress.

## MVP Build Order

Build in this order:

1. implement schemas for objectives, tasks, sessions, artifacts, and simple context entries
2. implement atomic task claiming
3. implement one local worker runtime with timeout and session capture
4. implement one controller that can run a small task DAG
5. implement reviewer-based retry
6. implement summarization into context entries
7. expose the real event stream in the terminal or UI

This is enough for a credible first product.

## Minimal End-to-End Flow

The first honest demo should look like this:

1. a user submits an objective
2. the controller creates a few tasks
3. an executor worker runs one task and writes an artifact
4. a reviewer accepts it or requests retry
5. a summarizer writes a short reusable summary
6. all workers terminate
7. the system can still reconstruct the full objective from durable state alone

If that works, the architecture is real.

## How To Grow Later

After the MVP is stable, add complexity in this order:

1. better context retrieval
2. parallel execution for independent tasks
3. remote worker targets
4. stricter sandbox and placement policy
5. operator-facing inspection UI

That keeps the design bottom-up and prevents the project from becoming a vague swarm demo before the foundations exist.
