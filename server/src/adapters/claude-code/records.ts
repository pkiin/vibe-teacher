/** Claude Code JSONL 레코드 형태 (CC 2.1.23x ~ 2.1.26x 기준, 필요한 필드만) */

export interface Envelope {
  uuid?: string;
  parentUuid?: string | null;
  sessionId?: string;
  timestamp?: string;
  cwd?: string;
  gitBranch?: string;
  version?: string;
  isSidechain?: boolean;
  isMeta?: boolean;
  promptId?: string;
  agentId?: string;
  slug?: string;
}

export interface TextBlock {
  type: 'text';
  text: string;
}
export interface ImageBlock {
  type: 'image';
  source?: unknown;
}
export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}
export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content?: string | Array<{ type: string; text?: string }>;
  is_error?: boolean;
}
export interface ThinkingBlock {
  type: 'thinking';
  thinking?: string;
  signature?: string;
}
export type ContentBlock = TextBlock | ImageBlock | ToolUseBlock | ToolResultBlock | ThinkingBlock | { type: string };

export interface UserRecord extends Envelope {
  type: 'user';
  message: { role: 'user'; content: string | ContentBlock[] };
  toolUseResult?: unknown;
  sourceToolAssistantUUID?: string;
  interruptedByShutdown?: boolean;
}

export interface AssistantRecord extends Envelope {
  type: 'assistant';
  message: {
    id?: string;
    model?: string;
    role: 'assistant';
    content: ContentBlock[];
    stop_reason?: string | null;
    usage?: Record<string, unknown>;
  };
  requestId?: string;
  apiBlockIndex?: number | null;
}

export interface SystemRecord extends Envelope {
  type: 'system';
  subtype?: string;
  content?: string;
  level?: string;
  error?: { message?: string; status?: number };
}

export interface AiTitleRecord {
  type: 'ai-title';
  aiTitle: string;
  sessionId?: string;
}
export interface LastPromptRecord {
  type: 'last-prompt';
  lastPrompt: string;
  sessionId?: string;
}

export type ClaudeRecord =
  | UserRecord
  | AssistantRecord
  | SystemRecord
  | AiTitleRecord
  | LastPromptRecord
  | { type: string; [k: string]: unknown };

export function isRecord(v: unknown): v is { type: string; [k: string]: unknown } {
  return !!v && typeof v === 'object' && typeof (v as { type?: unknown }).type === 'string';
}

export interface SubagentMeta {
  agentType?: string;
  description?: string;
  toolUseId?: string;
  spawnDepth?: number;
}
