#!/usr/bin/env node

const fs = require("node:fs");

const turn = JSON.parse(fs.readFileSync(0, "utf8"));
const threshold = Math.ceil(turn.maxTurns * 0.8);
if (turn.turn === threshold) {
  const terminalTool = turn.terminalToolName ?? "your terminal tool";
  process.stdout.write(
    JSON.stringify({
      notification:
        `Turn ${turn.turn} of ${turn.maxTurns} (80% of budget). ` +
        `Wrap up and submit via ${terminalTool}.`,
    }),
  );
}
