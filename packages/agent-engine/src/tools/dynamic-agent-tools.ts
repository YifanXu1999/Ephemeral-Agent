export interface DynamicAgentToolSelection {
  agenticWorkflows?: readonly string[];
  subagents?: readonly string[];
  advisor?: { prompt: string };
}
