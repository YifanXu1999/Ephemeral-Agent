#!/usr/bin/env node

const fs = require("node:fs");

const turn = JSON.parse(fs.readFileSync(0, "utf8"));
if (
  typeof turn.terminalToolName === "string" &&
  turn.toolCalls === 0 &&
  turn.backgroundTaskCount === 0 &&
  !turn.hasPendingSteers
) {
  process.stdout.write(
    JSON.stringify({
      notification:
        "You produced no tool call and have no background work. " +
        `To finish this run you must call your terminal tool ${turn.terminalToolName}.`,
    }),
  );
}
