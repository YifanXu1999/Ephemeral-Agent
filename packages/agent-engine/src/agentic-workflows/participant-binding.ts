export interface ParticipantBinding {
  kind: "agent" | "workflow";
  name: string;
  description?: string;
}

export type ParticipantBindings = Record<string, ParticipantBinding>;

export interface AgenticWorkflowConfig {
  name: string;
  type: string;
  module?: string;
  args: unknown;
  description: string;
  docs: string;
  participants: ParticipantBindings;
  tools: string[];
}
