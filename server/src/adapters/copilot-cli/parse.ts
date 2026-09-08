import path from 'node:path';
import type { Message, ToolCall, ToolCategory } from '@vibe-teacher/shared';
import { readJsonl } from '../../lib/jsonl';
import { capStrings, stringifyUnknown, toIso, truncate } from '../../lib/text';
import { emptyCounts, type NormalizedDraft } from '../types';
import type { CopilotEvent } from './records';

function str(o: Record<string, unknown> | undefined, k: string): string | undefined {
  const v = o?.[k];
  return typeof v === 'string' ? v : undefined;
}

export function mapCopilotTool(id: string, toolName: string, args: Record<string, unknown>): ToolCall {
  const base = { id, name: toolName, input: args, paths: [] as string[] };
  const p = str(args, 'path') ?? str(args, 'file_path') ?? str(args, 'filePath');
  const withPath = (category: ToolCategory): ToolCall => ({ ...base, category, paths: p ? [p] : [] });
  switch (toolName) {
    case 'bash':
    case 'powershell':
    case 'shell':
      return { ...base, category: 'shell', command: str(args, 'command'), description: str(args, 'description') };
    case 'create':
    case 'create_file':
    case 'write':
      return withPath('file_write');
    case 'edit':
    case 'edit_file':
    case 'str_replace':
      return withPath('file_edit');
    case 'str_replace_editor': {
      const cmd = str(args, 'command');
      return withPath(cmd === 'create' ? 'file_write' : cmd === 'view' ? 'file_read' : 'file_edit');
    }
    case 'view':
    case 'read':
    case 'read_file':
      return withPath('file_read');
    case 'grep':
    case 'glob':
    case 'search':
      return { ...base, category: 'search', description: str(args, 'pattern') ?? str(args, 'query') };
    case 'task':
      return { ...base, category: 'agent', description: str(args, 'description') ?? str(args, 'prompt') };
    case 'web_fetch':
    case 'fetch':
      return { ...base, category: 'web', description: str(args, 'url') };
    default:
      return { ...base, category: 'other' };
  }
}

export async function parseCopilotCliFile(filePath: string): Promise<{ draft: NormalizedDraft }> {
  const warnings: string[] = [];
  const messages: Message[] = [];
  const toolCalls: ToolCall[] = [];
  const pending = new Map<string, ToolCall>();
  const fifo: ToolCall[] = [];
  const counts = emptyCounts();
  const models = new Set<string>();
  let cwd: string | undefined;
  let startedAt: string | undefined;
  let endedAt: string | undefined;
  let version: string | undefined;
  let title: string | undefined;
  let firstPrompt: string | undefined;
  let gitBranch: string | undefined;

  const push = (m: Omit<Message, 'index' | 'id'> & { id?: string }): Message => {
    const msg: Message = { ...m, id: m.id ?? `${messages.length}`, index: messages.length };
    messages.push(msg);
    return msg;
  };
  const noteTs = (ts: unknown) => {
    const iso = toIso(ts);
    if (!iso) return;
    if (!startedAt || iso < startedAt) startedAt = iso;
    if (!endedAt || iso > endedAt) endedAt = iso;
  };

  for await (const { value } of readJsonl(filePath, { strip: (v) => capStrings(v, 4000), warnings })) {
    const ev = value as CopilotEvent;
    if (!ev || typeof ev !== 'object' || typeof ev.type !== 'string') continue;
    const data = (ev.data ?? {}) as Record<string, unknown>;
    noteTs(ev.timestamp ?? data.timestamp);
    const ts = toIso(ev.timestamp ?? data.timestamp);
    switch (ev.type) {
      case 'session.start':
      case 'session.resume': {
        const ctx = (data.context ?? {}) as Record<string, unknown>;
        cwd = cwd ?? str(ctx, 'cwd') ?? str(ctx, 'gitRoot');
        const model = str(data, 'selectedModel');
        if (model) models.add(model);
        noteTs(data.startTime);
        version = version ?? str(data, 'version') ?? str(data, 'copilotVersion');
        gitBranch = gitBranch ?? str(ctx, 'branch');
        break;
      }
      case 'session.model_change': {
        const m = str(data, 'newModel');
        if (m) models.add(m);
        break;
      }
      case 'session.title_changed':
        title = str(data, 'title') ?? title;
        break;
      case 'child_session_ref':
        counts.subagents += 1;
        break;
      case 'user.message': {
        const source = str(data, 'source');
        const content = str(data, 'content') ?? '';
        if (source && source !== 'user' && !source.startsWith('command-')) break;
        if (!content.trim()) break;
        if (source?.startsWith('command-')) {
          counts.slashCommands += 1;
          const name = source.slice('command-'.length);
          if (!firstPrompt) firstPrompt = `/${name}`;
          push({ role: 'slash-command', text: content.trim(), timestamp: ts, meta: { commandName: name } });
        } else {
          counts.human += 1;
          if (!firstPrompt) firstPrompt = content.trim();
          push({ role: 'human', text: content.trim(), timestamp: ts });
        }
        break;
      }
      case 'assistant.message': {
        const content = str(data, 'content') ?? '';
        if (!content.trim()) break;
        counts.assistant += 1;
        push({ role: 'assistant', text: content, timestamp: ts, meta: { model: str(data, 'model') } });
        break;
      }
      case 'tool.execution_start':
      case 'tool.execution_started': {
        const toolName = str(data, 'toolName') ?? str(data, 'name') ?? 'tool';
        if (toolName === 'report_intent') break;
        const id = str(data, 'toolCallId') ?? str(data, 'id') ?? ev.id ?? `tool-${toolCalls.length}`;
        const args = (data.arguments && typeof data.arguments === 'object' ? data.arguments : {}) as Record<string, unknown>;
        const tc = mapCopilotTool(id, toolName, args);
        tc.timestamp = ts;
        counts.toolCalls += 1;
        const m = push({ role: 'tool_use', toolCall: tc, timestamp: ts });
        tc.messageIndex = m.index;
        toolCalls.push(tc);
        pending.set(id, tc);
        fifo.push(tc);
        break;
      }
      case 'tool.execution_complete': {
        const toolName = str(data, 'toolName');
        if (toolName === 'report_intent') break;
        const id = str(data, 'toolCallId') ?? str(data, 'id');
        let tc = id ? pending.get(id) : undefined;
        if (!tc) tc = fifo.find((t) => !t.result);
        if (!tc) break;
        pending.delete(tc.id);
        const ok = data.success !== false;
        const result = data.result as Record<string, unknown> | string | undefined;
        const content = typeof result === 'string' ? result : result && typeof result === 'object' ? stringifyUnknown(result.content ?? result) : '';
        tc.result = { ok, summary: truncate(content, 300) };
        if (tc.category === 'shell') tc.result.structured = { stdout: truncate(content, 4000), stderr: '' };
        else if (tc.category === 'file_write' && ok && tc.paths[0]) tc.result.structured = { kind: 'create', filePath: tc.paths[0] };
        else if (tc.category === 'file_edit' && ok && tc.paths[0]) tc.result.structured = { kind: 'update', filePath: tc.paths[0] };
        push({ role: 'tool_result', toolUseId: tc.id, text: truncate(content, 2000), isError: !ok, timestamp: ts });
        break;
      }
      case 'compaction':
        push({ role: 'system-injected', text: '컨텍스트가 요약(compaction)되었습니다', timestamp: ts, meta: { subtype: 'compaction' } });
        break;
      case 'turn.error':
      case 'session.error':
        push({ role: 'system-injected', text: truncate(stringifyUnknown(data.message ?? data.error ?? data), 300), timestamp: ts, isError: true, meta: { subtype: ev.type } });
        break;
      default:
        break;
    }
  }

  const draft: NormalizedDraft = {
    sessionId: path.basename(path.dirname(filePath)),
    title: truncate(title ?? firstPrompt ?? '(제목 없음)', 60),
    firstPrompt,
    startedAt,
    endedAt,
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
  return { draft };
}
