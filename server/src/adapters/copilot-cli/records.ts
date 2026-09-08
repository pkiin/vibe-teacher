/** GitHub Copilot CLI `session-state/<id>/events.jsonl` (VS Code 확장 번들에서 확인한 필드) */
export interface CopilotEvent {
  id?: string;
  type: string;
  timestamp?: string;
  data?: Record<string, unknown>;
}
