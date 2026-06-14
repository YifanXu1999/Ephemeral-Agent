import type { JsonObject } from "@ephai/agent-core";

export interface AgenticWorkflowContextListing {
  entries: JsonObject[];
}

export interface AgenticWorkflowContextQuery {
  text: string;
}

export interface AgenticWorkflowContextResult {
  results: JsonObject[];
}
