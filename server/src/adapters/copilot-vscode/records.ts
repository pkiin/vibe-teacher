/** VS Code chat 세션 JSON (`ISerializableChatData` v1~3, 필요한 필드만) */
export interface VscodeChatSession {
  version?: number;
  sessionId?: string;
  creationDate?: number;
  lastMessageDate?: number;
  customTitle?: string;
  computedTitle?: string;
  initialLocation?: string;
  requesterUsername?: string;
  responderUsername?: string;
  requests?: VscodeChatRequest[];
}

export interface VscodeChatRequest {
  requestId?: string;
  message?: string | { text?: string; parts?: unknown[] };
  response?: VscodeResponsePart[];
  result?: { errorDetails?: { message?: string }; metadata?: unknown };
  timestamp?: number;
  agent?: { id?: string; name?: string };
  modelId?: string;
  command?: string;
  isCanceled?: boolean;
}

export interface VscodeResponsePart {
  kind?: string;
  value?: string | { value?: string };
  toolId?: string;
  toolCallId?: string;
  invocationMessage?: string | { value?: string };
  pastTenseMessage?: string | { value?: string };
  isConfirmed?: boolean;
  isComplete?: boolean;
  toolSpecificData?: { kind?: string; commandLine?: { original?: string; userEdited?: string }; command?: string };
  uri?: { path?: string; fsPath?: string; external?: string } | string;
  edits?: unknown[];
  resultDetails?: unknown;
  [k: string]: unknown;
}
