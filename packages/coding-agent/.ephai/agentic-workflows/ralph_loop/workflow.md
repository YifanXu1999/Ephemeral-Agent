---
name: ralph_loop
type: ralph_loop
description: Sequential planner, reviewer, critic retry loop.
module: ./workflow.mjs
participants:
  planner:
    kind: agent
    name: subagent
  reviewer:
    kind: agent
    name: subagent
  critic:
    kind: agent
    name: subagent
tools:
  - delegate_ralph_loop
args:
  max_attempts: 3
---
# ralph_loop

Sequential planner, reviewer, critic retry loop.
