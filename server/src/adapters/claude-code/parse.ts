import type { FileResult, Message, ShellResult, ToolCall, ToolCategory } from '@vibe-teacher/shared';
import { readJsonl } from '../../lib/jsonl';
import { capStrings, toIso, truncate } from '../../lib/text';
import { emptyCounts, type NormalizedDraft } from '../types';
import { classifySystemRecord, classifyUserRecord } from './classify';
import {
  isRecord,
  type AssistantRecord,
  type ContentBlock,
  type SystemRecord,
  type ToolResultBlock,
  type ToolUseBlock,
  type UserRecord,
} from './records';

export interface ClaudeParseOptions {
  /** 메시지/도구 호출을 저장하지 않고 집계만 (scan 용) */
  light?: boolean;
  /** 서브에이전트 파일을 파싱 중이면 그 id */
  subagentId?: string;
  parentMessageIndex?: number;
  startIndex?: number;
}

export interface ClaudeParseResult {
  draft: NormalizedDraft;
  cwd?: string;
  aiTitle?: string;
  lastPrompt?: string;
  /** Agent 도구 결과의 agentId → 그 tool_use 메시지 인덱스 */
  agentIdToMessageIndex: Map<string, number>;
  errors: number;
}

const MAX_RESULT_TEXT = 4000;
const MAX_INPUT_STRING = 3000;

/** 파싱 직후 무거운 필드를 버려 메모리를 평평하게 유지한다. */
export function stripClaudeRecord(value: unknown): unknown {
  if (!isRecord(value)) return value;
  if (value.type === 'attachment') return { type: 'attachment' };
  if (value.type === 'file-history-snapshot' || value.type === 'file-history-delta') return { type: value.type };
  const msg = (value as { message?: { content?: unknown } }).message;
  if (msg && Array.isArray(msg.content)) {
    for (const b of msg.content as Array<Record<string, unknown>>) {
      if (!b || typeof b !== 'object') continue;
      if (b.type === 'thinking') {
        delete b.signature;
        b.thinking = truncate(typeof b.thinking === 'string' ? b.thinking : '', 200);
      } else if (b.type === 'tool_result') {
        if (typeof b.content === 'string') b.content = truncate(b.content, MAX_RESULT_TEXT);
        else if (Array.isArray(b.content)) {
          b.content = b.content.map((x: Record<string, unknown>) =>
            x && x.type === 'text' ? { ...x, text: truncate(typeof x.text === 'string' ? x.text : '', MAX_RESULT_TEXT) } : x,
          );
        }
      } else if (b.type === 'tool_use') {
        b.input = capStrings(b.input, MAX_INPUT_STRING);
      } else if (b.type === 'image') {
        b.source = undefined;
      }
    }
  }
  const rec = value as { toolUseResult?: unknown };
  if (rec.toolUseResult !== undefined) rec.toolUseResult = capStrings(rec.toolUseResult, MAX_RESULT_TEXT);
  return value;
}

const PLAN_TOOLS = new Set([
  'ExitPlanMode',
  'EnterPlanMode',
  'TodoWrite',
  'Skill',
  'Artifact',
  'TaskStop',
  'TaskOutput',
  'Monitor',
  'ScheduleWakeup',
  'CronCreate',
  'CronDelete',
  'CronList',
  'SendMessage',
  'ListAgents',
  'ReportFindings',
]);

function str(input: Record<string, unknown>, key: string): string | undefined {
  const v = input[key];
  return typeof v === 'string' ? v : undefined;
}

export function mapClaudeTool(block: ToolUseBlock): ToolCall {
  const input = (block.input && typeof block.input === 'object' ? block.input : {}) as Record<string, unknown>;
  const name = block.name;
  const base = { id: block.id, name, input, paths: [] as string[] };
  const withPath = (category: ToolCategory, key: string, extra: Partial<ToolCall> = {}): ToolCall => {
    const p = str(input, key);
    return { ...base, category, paths: p ? [p] : [], ...extra };
  };
  switch (name) {
    case 'Bash':
    case 'PowerShell':
      return { ...base, category: 'shell', command: str(input, 'command'), description: str(input, 'description') };
    case 'Write':
      return withPath('file_write', 'file_path');
    case 'Edit':
    case 'MultiEdit':
      return withPath('file_edit', 'file_path');
    case 'NotebookEdit':
      return withPath('file_edit', 'notebook_path');
    case 'Read':
      return withPath('file_read', 'file_path');
    case 'Glob':
    case 'Grep':
    case 'LS':
      return withPath('search', 'path', { description: str(input, 'pattern') });
    case 'ToolSearch':
      return { ...base, category: 'search', description: str(input, 'query') };
    case 'Agent':
    case 'Task':
      return { ...base, category: 'agent', description: str(input, 'description') };
    case 'WebFetch':
      return { ...base, category: 'web', description: str(input, 'url') };
    case 'WebSearch':
      return { ...base, category: 'web', description: str(input, 'query') };
    case 'AskUserQuestion':
      return { ...base, category: 'question' };
    default:
      return { ...base, category: PLAN_TOOLS.has(name) ? 'plan' : 'other', description: str(input, 'description') };
  }
}

function resultText(content: ToolResultBlock['content']): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (c && c.type === 'text' && typeof c.text === 'string' ? c.text : ''))
      .filter(Boolean)
      .join('\n');
  }
  return '';
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

function patchLineCounts(patch: unknown): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  if (Array.isArray(patch)) {
    for (const hunk of patch) {
      const lines = isObj(hunk) && Array.isArray(hunk.lines) ? (hunk.lines as unknown[]) : [];
      for (const l of lines) {
        if (typeof l !== 'string') continue;
        if (l.startsWith('+')) added += 1;
        else if (l.startsWith('-')) removed += 1;
      }
    }
  }
  return { added, removed };
}

export function applyClaudeResult(tc: ToolCall, block: ToolResultBlock, toolUseResult: unknown): void {
  const text = resultText(block.content);
  const ok = !block.is_error;
  let structured: FileResult | ShellResult | undefined;
  const tur = toolUseResult;
  if (tc.category === 'shell' && isObj(tur)) {
    structured = {
      stdout: typeof tur.stdout === 'string' ? tur.stdout : '',
      stderr: typeof tur.stderr === 'string' ? tur.stderr : '',
      interrupted: tur.interrupted === true,
    };
  } else if (tc.name === 'Write' && ok) {
    const filePath = (isObj(tur) && typeof tur.filePath === 'string' ? tur.filePath : tc.paths[0]) ?? '';
    structured = { kind: isObj(tur) && tur.type === 'create' ? 'create' : 'update', filePath };
  } else if ((tc.name === 'Edit' || tc.name === 'MultiEdit' || tc.name === 'NotebookEdit') && ok) {
    const filePath = (isObj(tur) && typeof tur.filePath === 'string' ? tur.filePath : tc.paths[0]) ?? '';
    const counts = patchLineCounts(isObj(tur) ? tur.structuredPatch : undefined);
    structured = { kind: 'update', filePath, linesAdded: counts.added, linesRemoved: counts.removed };
  }
  tc.result = { ok, summary: truncate(text || (isObj(tur) && typeof tur.stdout === 'string' ? tur.stdout : ''), 300), structured };
}

/**
 * Claude Code 세션 JSONL 한 파일을 정규화한다.
 * - assistant 는 블록당 한 줄이므로 message.id 로 묶는다 (파일 순서, apiBlockIndex 미사용)
 * - tool_use ↔ tool_result 는 tool_use_id 로 연결
 */
export async function parseClaudeFile(filePath: string, opts: ClaudeParseOptions = {}): Promise<ClaudeParseResult> {
  const light = opts.light === true;
  const warnings: string[] = [];
  const messages: Message[] = [];
  const toolCalls: ToolCall[] = [];
  const pending = new Map<string, ToolCall>();
  const agentIdToMessageIndex = new Map<string, number>();
  const counts = emptyCounts();
  const models = new Set<string>();
  const startIndex = opts.startIndex ?? 0;

  let cwd: string | undefined;
  let gitBranch: string | undefined;
  let version: string | undefined;
  let sessionId: string | undefined;
  let firstTs: string | undefined;
  let lastTs: string | undefined;
  let aiTitle: string | undefined;
  let lastPrompt: string | undefined;
  let firstPrompt: string | undefined;
  let errors = 0;
  let unmatchedResults = 0;
  let lastCountedAssistantId: string | undefined;
  let lastAssistantText: { msgId: string; message: Message } | undefined;
  let lastHumanText: string | undefined;

  const nextIndex = () => startIndex + messages.length;
  const push = (m: Omit<Message, 'index' | 'id'> & { id?: string }): Message | undefined => {
    if (light) return undefined;
    const msg: Message = { ...m, id: m.id ?? `${startIndex}-${messages.length}`, index: nextIndex() };
    if (opts.subagentId) msg.meta = { ...(msg.meta ?? {}), subagentId: opts.subagentId };
    messages.push(msg);
    return msg;
  };

  const noteEnvelope = (rec: { timestamp?: string; cwd?: string; gitBranch?: string; version?: string; sessionId?: string }) => {
    const ts = toIso(rec.timestamp);
    if (ts) {
      if (!firstTs || ts < firstTs) firstTs = ts;
      if (!lastTs || ts > lastTs) lastTs = ts;
    }
    if (!cwd && typeof rec.cwd === 'string' && rec.cwd) cwd = rec.cwd;
    if (!gitBranch && typeof rec.gitBranch === 'string' && rec.gitBranch) gitBranch = rec.gitBranch;
    if (!version && typeof rec.version === 'string') version = rec.version;
    if (!sessionId && typeof rec.sessionId === 'string') sessionId = rec.sessionId;
  };

  const handleUser = (rec: UserRecord) => {
    noteEnvelope(rec);
    const cls = classifyUserRecord(rec);
    const ts = toIso(rec.timestamp);
    switch (cls.kind) {
      case 'tool_result': {
        const content = Array.isArray(rec.message?.content) ? rec.message.content : [];
        for (const block of content as ContentBlock[]) {
          if (!block || block.type !== 'tool_result') continue;
          const tr = block as ToolResultBlock;
          const tc = pending.get(tr.tool_use_id);
          if (!tc) {
            unmatchedResults += 1;
            continue;
          }
          pending.delete(tr.tool_use_id);
          applyClaudeResult(tc, tr, rec.toolUseResult);
          if (tc.category === 'agent' && isObj(rec.toolUseResult) && typeof rec.toolUseResult.agentId === 'string' && tc.messageIndex != null) {
            agentIdToMessageIndex.set(rec.toolUseResult.agentId, tc.messageIndex);
          }
          if (tr.is_error) errors += 1;
          push({
            role: 'tool_result',
            toolUseId: tr.tool_use_id,
            text: truncate(tc.result?.summary ?? '', 2000),
            isError: tr.is_error === true,
            timestamp: ts,
          });
        }
        return;
      }
      case 'skip':
        return;
      case 'system-injected':
        push({ role: 'system-injected', text: truncate(cls.text, 300), timestamp: ts });
        return;
      case 'interrupt':
        push({ role: 'interrupt', text: cls.text, timestamp: ts });
        return;
      case 'slash-command':
        if (opts.subagentId) return;
        counts.slashCommands += 1;
        if (!firstPrompt) firstPrompt = `/${cls.name}`;
        push({
          role: 'slash-command',
          text: cls.text,
          timestamp: ts,
          meta: { commandName: cls.name, commandArgs: cls.args },
        });
        return;
      case 'human':
        if (opts.subagentId) return;
        counts.human += 1;
        if (!firstPrompt) firstPrompt = cls.text;
        lastHumanText = cls.text;
        push({
          role: 'human',
          text: cls.text,
          timestamp: ts,
          meta: {
            openedFiles: cls.openedFiles.length ? cls.openedFiles : undefined,
            hasImage: cls.hasImage || undefined,
          },
        });
        return;
    }
  };

  const handleAssistant = (rec: AssistantRecord) => {
    noteEnvelope(rec);
    const msgId = rec.message?.id ?? rec.requestId ?? rec.uuid ?? '';
    const model = rec.message?.model;
    if (model) models.add(model);
    const ts = toIso(rec.timestamp);
    const blocks = Array.isArray(rec.message?.content) ? rec.message.content : [];
    for (const block of blocks as ContentBlock[]) {
      if (!block || typeof block !== 'object') continue;
      if (block.type === 'text') {
        const text = (block as { text?: string }).text ?? '';
        if (!text.trim()) continue;
        if (lastCountedAssistantId !== msgId) {
          counts.assistant += 1;
          lastCountedAssistantId = msgId;
        }
        if (light) continue;
        if (lastAssistantText && lastAssistantText.msgId === msgId && messages[messages.length - 1] === lastAssistantText.message) {
          lastAssistantText.message.text = `${lastAssistantText.message.text ?? ''}\n\n${text}`;
        } else {
          const m = push({ role: 'assistant', text, timestamp: ts, meta: { model } });
          if (m) lastAssistantText = { msgId, message: m };
        }
      } else if (block.type === 'tool_use') {
        if (lastCountedAssistantId !== msgId) {
          counts.assistant += 1;
          lastCountedAssistantId = msgId;
        }
        counts.toolCalls += 1;
        const tc = mapClaudeTool(block as ToolUseBlock);
        tc.timestamp = ts;
        if (opts.subagentId) {
          tc.subagentId = opts.subagentId;
          tc.parentMessageIndex = opts.parentMessageIndex;
        }
        if (!light) {
          const m = push({ role: 'tool_use', toolCall: tc, timestamp: ts, meta: { model } });
          tc.messageIndex = m?.index;
          toolCalls.push(tc);
        }
        pending.set(tc.id, tc);
      }
      // thinking 등은 버림
    }
  };

  const handleSystem = (rec: SystemRecord) => {
    noteEnvelope(rec);
    const cls = classifySystemRecord(rec);
    const ts = toIso(rec.timestamp);
    if (cls.kind === 'human') {
      if (opts.subagentId) return;
      if (lastHumanText === cls.text) return; // 같은 원문이 두 번 기록되는 경우
      counts.human += 1;
      lastHumanText = cls.text;
      if (!firstPrompt) firstPrompt = cls.text;
      push({ role: 'human', text: cls.text, timestamp: ts, meta: { viaLocalCommand: true } });
    } else if (cls.kind === 'system-injected') {
      if (cls.isError) errors += 1;
      push({ role: 'system-injected', text: truncate(cls.text, 300), timestamp: ts, isError: cls.isError, meta: { subtype: cls.subtype } });
    }
  };

  for await (const { value } of readJsonl(filePath, { strip: stripClaudeRecord, warnings })) {
    if (!isRecord(value)) continue;
    switch (value.type) {
      case 'user':
        handleUser(value as unknown as UserRecord);
        break;
      case 'assistant':
        handleAssistant(value as unknown as AssistantRecord);
        break;
      case 'system':
        handleSystem(value as unknown as SystemRecord);
        break;
      case 'ai-title':
        if (typeof value.aiTitle === 'string' && value.aiTitle.trim()) aiTitle = value.aiTitle.trim();
        break;
      case 'last-prompt':
        if (typeof value.lastPrompt === 'string' && value.lastPrompt.trim()) lastPrompt = value.lastPrompt.trim();
        break;
      default:
        break;
    }
  }

  if (unmatchedResults > 0) warnings.push(`${unmatchedResults} tool results had no matching tool_use`);

  const draft: NormalizedDraft = {
    sessionId: sessionId ?? '',
    title: '',
    firstPrompt,
    startedAt: firstTs,
    endedAt: lastTs,
    filePath,
    fileSize: 0,
    fileMtime: 0,
    projectRoot: cwd ?? '',
    counts,
    models: Array.from(models),
    gitBranch,
    toolVersion: version,
    messages,
    toolCalls,
    parseWarnings: warnings,
  };
  return { draft, cwd, aiTitle, lastPrompt, agentIdToMessageIndex, errors };
}
