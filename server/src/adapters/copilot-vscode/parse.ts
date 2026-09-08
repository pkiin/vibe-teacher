import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Message, ToolCall } from '@vibe-teacher/shared';
import { stringifyUnknown, toIso, truncate } from '../../lib/text';
import { emptyCounts, type NormalizedDraft } from '../types';
import type { VscodeChatSession, VscodeResponsePart } from './records';

const KNOWN_COMMANDS = new Set(['fix', 'explain', 'tests', 'new', 'doc', 'help', 'clear', 'search', 'newNotebook', 'setupTests', 'fixTestFailure']);

function uriPath(u: VscodeResponsePart['uri']): string | undefined {
  if (!u) return undefined;
  if (typeof u === 'string') {
    if (u.startsWith('file:')) {
      try {
        return fileURLToPath(u);
      } catch {
        return u;
      }
    }
    return u;
  }
  return u.fsPath ?? u.path ?? (u.external?.startsWith('file:') ? safeUrlToPath(u.external) : undefined);
}

function safeUrlToPath(u: string): string | undefined {
  try {
    return fileURLToPath(u);
  } catch {
    return undefined;
  }
}

function textOf(v: unknown): string {
  if (typeof v === 'string') return v;
  if (v && typeof v === 'object' && typeof (v as { value?: unknown }).value === 'string') return (v as { value: string }).value;
  return '';
}

function mapVscodeTool(id: string, part: VscodeResponsePart): ToolCall {
  const toolId = part.toolId ?? 'tool';
  const base = { id, name: toolId, input: { invocation: textOf(part.invocationMessage), toolSpecificData: part.toolSpecificData }, paths: [] as string[] };
  const lower = toolId.toLowerCase();
  if (/terminal|run_in_terminal|shell|bash/.test(lower)) {
    const cmd = part.toolSpecificData?.commandLine?.userEdited ?? part.toolSpecificData?.commandLine?.original ?? part.toolSpecificData?.command;
    return { ...base, category: 'shell', command: cmd, description: textOf(part.invocationMessage) };
  }
  if (/create_file|create/.test(lower)) return { ...base, category: 'file_write' };
  if (/edit|apply_patch|replace|insert/.test(lower)) return { ...base, category: 'file_edit' };
  if (/read_file|read/.test(lower)) return { ...base, category: 'file_read' };
  if (/search|grep|find|list_dir|glob/.test(lower)) return { ...base, category: 'search', description: textOf(part.invocationMessage) };
  if (/fetch|web/.test(lower)) return { ...base, category: 'web', description: textOf(part.invocationMessage) };
  if (/runsubagent|agent|task/.test(lower)) return { ...base, category: 'agent', description: textOf(part.invocationMessage) };
  return { ...base, category: 'other', description: textOf(part.invocationMessage) };
}

export function normalizeVscodeSession(data: VscodeChatSession, filePath: string, workspaceRoot: string | undefined): NormalizedDraft {
  const messages: Message[] = [];
  const toolCalls: ToolCall[] = [];
  const counts = emptyCounts();
  const models = new Set<string>();
  const warnings: string[] = [];
  let firstPrompt: string | undefined;
  const push = (m: Omit<Message, 'index' | 'id'> & { id?: string }): Message => {
    const msg: Message = { ...m, id: m.id ?? `${messages.length}`, index: messages.length };
    messages.push(msg);
    return msg;
  };

  for (const req of data.requests ?? []) {
    const ts = toIso(req.timestamp);
    const text = (typeof req.message === 'string' ? req.message : req.message?.text ?? '').trim();
    if (req.modelId) models.add(req.modelId);
    if (text) {
      const cmdMatch = /^\/(\w+)\b\s*(.*)$/s.exec(text);
      const command = req.command ?? (cmdMatch && KNOWN_COMMANDS.has(cmdMatch[1] ?? '') ? cmdMatch[1] : undefined);
      if (command) {
        counts.slashCommands += 1;
        if (!firstPrompt) firstPrompt = `/${command}`;
        push({ role: 'slash-command', text: text.startsWith('/') ? text.slice(1) : `${command} ${text}`, timestamp: ts, meta: { commandName: command } });
      } else {
        counts.human += 1;
        if (!firstPrompt) firstPrompt = text;
        push({ role: 'human', text, timestamp: ts });
      }
    }
    let assistantBuf: string[] = [];
    const flushAssistant = () => {
      const t = assistantBuf.join('').trim();
      if (t) {
        counts.assistant += 1;
        push({ role: 'assistant', text: t, timestamp: ts, meta: { model: req.modelId } });
      }
      assistantBuf = [];
    };
    for (const part of req.response ?? []) {
      if (!part || typeof part !== 'object') continue;
      const kind = part.kind ?? (typeof part.value === 'string' ? 'markdownContent' : 'unknown');
      if (kind === 'markdownContent' || kind === 'textContent' || (!part.kind && part.value !== undefined)) {
        assistantBuf.push(textOf(part.value));
      } else if (kind === 'toolInvocationSerialized') {
        flushAssistant();
        const id = part.toolCallId ?? `${req.requestId ?? 'req'}-${toolCalls.length}`;
        const tc = mapVscodeTool(id, part);
        tc.timestamp = ts;
        counts.toolCalls += 1;
        const m = push({ role: 'tool_use', toolCall: tc, timestamp: ts });
        tc.messageIndex = m.index;
        toolCalls.push(tc);
        const ok = part.isConfirmed !== false;
        tc.result = { ok, summary: truncate(textOf(part.pastTenseMessage) || stringifyUnknown(part.resultDetails, 300), 300) };
      } else if (kind === 'textEditGroup' || kind === 'notebookEditGroup') {
        flushAssistant();
        const p = uriPath(part.uri);
        const abs = p && !path.isAbsolute(p) && workspaceRoot ? path.join(workspaceRoot, p) : p;
        const tc: ToolCall = {
          id: `${req.requestId ?? 'req'}-edit-${toolCalls.length}`,
          name: 'textEditGroup',
          category: 'file_edit',
          paths: abs ? [abs] : [],
          input: { edits: Array.isArray(part.edits) ? part.edits.length : undefined },
          timestamp: ts,
          result: abs ? { ok: true, summary: `edit ${abs}`, structured: { kind: 'update', filePath: abs } } : { ok: true, summary: 'edit' },
        };
        counts.toolCalls += 1;
        const m = push({ role: 'tool_use', toolCall: tc, timestamp: ts });
        tc.messageIndex = m.index;
        toolCalls.push(tc);
      }
      // 알 수 없는 part 는 무시
    }
    flushAssistant();
    if (req.result?.errorDetails?.message) push({ role: 'system-injected', text: truncate(req.result.errorDetails.message, 300), timestamp: ts, isError: true, meta: { subtype: 'error' } });
    if (req.isCanceled) push({ role: 'interrupt', text: '[요청 취소됨]', timestamp: ts });
  }

  const startedAt = toIso(data.creationDate) ?? messages.find((m) => m.timestamp)?.timestamp;
  const endedAt = toIso(data.lastMessageDate) ?? [...messages].reverse().find((m) => m.timestamp)?.timestamp ?? startedAt;
  return {
    sessionId: data.sessionId ?? path.basename(filePath, '.json'),
    title: truncate(data.customTitle ?? data.computedTitle ?? firstPrompt ?? '(제목 없음)', 60),
    firstPrompt,
    startedAt,
    endedAt,
    filePath,
    fileSize: 0,
    fileMtime: 0,
    projectRoot: workspaceRoot ?? '',
    counts,
    models: Array.from(models),
    toolVersion: data.version != null ? `chat-v${data.version}` : undefined,
    messages,
    toolCalls,
    parseWarnings: warnings,
  };
}

export async function parseVscodeChatFile(filePath: string, workspaceRoot: string | undefined): Promise<NormalizedDraft> {
  const raw = await fsp.readFile(filePath, 'utf8');
  let data: VscodeChatSession;
  try {
    data = JSON.parse(raw) as VscodeChatSession;
  } catch (err) {
    throw new Error(`JSON 파싱 실패: ${(err as Error).message}`);
  }
  if (!data || typeof data !== 'object' || !Array.isArray(data.requests)) throw new Error('지원하지 않는 세션 형식 (requests 배열 없음)');
  return normalizeVscodeSession(data, filePath, workspaceRoot);
}
