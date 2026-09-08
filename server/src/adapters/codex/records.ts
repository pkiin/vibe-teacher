/** OpenAI Codex CLI rollout JSONL (openai/codex `codex-rs/protocol` 기준, 필요한 필드만) */

export interface RolloutLine {
  timestamp?: string;
  type: 'session_meta' | 'response_item' | 'event_msg' | 'turn_context' | 'compacted' | string;
  payload?: unknown;
}

export interface SessionMetaPayload {
  id?: string;
  session_id?: string;
  timestamp?: string;
  cwd?: string;
  originator?: string;
  cli_version?: string;
  source?: unknown;
  model_provider?: string | null;
  git?: { commit_hash?: string; branch?: string; repository_url?: string } | null;
}

export interface TurnContextPayload {
  cwd?: string;
  model?: string;
  effort?: string;
  user_instructions?: string;
}

export interface ContentPart {
  type: 'input_text' | 'output_text' | 'input_image' | string;
  text?: string;
}

export type ResponseItemPayload =
  | { type: 'message'; role: 'user' | 'assistant' | 'developer' | 'system'; content?: ContentPart[] | string; id?: string }
  | { type: 'function_call'; name: string; arguments?: string; call_id?: string; id?: string }
  | { type: 'function_call_output'; call_id?: string; output?: string | { content?: string; success?: boolean; exit_code?: number } }
  | { type: 'custom_tool_call'; name: string; input?: string; call_id?: string }
  | { type: 'custom_tool_call_output'; call_id?: string; output?: string }
  | { type: 'local_shell_call'; call_id?: string; id?: string; action?: { type?: string; command?: string[]; working_directory?: string } ; status?: string }
  | { type: 'web_search_call'; id?: string; action?: { query?: string } }
  | { type: 'reasoning'; summary?: unknown }
  | { type: string; [k: string]: unknown };

export type EventMsgPayload =
  | { type: 'user_message'; message?: string; images?: string[]; local_images?: string[] }
  | { type: 'agent_message'; message?: string }
  | { type: 'exec_command_end'; call_id?: string; exit_code?: number; stdout?: string; stderr?: string }
  | { type: 'task_started' | 'task_complete' | 'token_count' | 'agent_reasoning' | 'turn_aborted' | string; [k: string]: unknown };
