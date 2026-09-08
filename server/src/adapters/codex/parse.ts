import path from 'node:path';
import type { Message, ToolCall } from '@vibe-teacher/shared';
import { readJsonl } from '../../lib/jsonl';
import { capStrings, stripTagBlock, toIso, truncate } from '../../lib/text';
import { emptyCounts, type NormalizedDraft } from '../types';
import { parseApplyPatch } from './apply-patch';
import type { EventMsgPayload, ResponseItemPayload, RolloutLine, SessionMetaPayload, TurnContextPayload } from './records';

const WRAPPER_TAGS = ['environment_context', 'user_instructions', 'permissions instructions', 'permissions_instructions', 'turn_context', 'AGENTS.md'];

export function cleanCodexUserText(text: string): string {
  let t = text;
  for (const tag of WRAPPER_TAGS) t = stripTagBlock(t, tag.replace(/ /g, '[ _]'));
  return t.trim();
}

function strip(value: unknown): unknown {
  return capStrings(value, 4000);
}

function partsText(content: ResponseItemPayload extends { content?: infer C } ? C : unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((p) => (p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string' ? ((p as { text: string }).text) : ''))
    .filter(Boolean)
    .join('\n');
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object') return raw as Record<string, unknown>;
  if (typeof raw !== 'string') return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : { raw };
  } catch {
    return { raw };
  }
}

function commandString(a: Record<string, unknown>): string | undefined {
  const c = a.command ?? a.cmd;
  if (Array.isArray(c)) return c.map(String).join(' ');
  if (typeof c === 'string') return c;
  return undefined;
}

export function mapCodexTool(id: string, name: string, args: Record<string, unknown>): ToolCall[] {
  const base = { id, name, input: args, paths: [] as string[] };
  switch (name) {
    case 'shell':
    case 'shell_command':
    case 'exec_command':
    case 'container.exec':
    case 'local_shell':
      return [{ ...base, category: 'shell', command: commandString(args), description: typeof args.justification === 'string' ? args.justification : undefined }];
    case 'apply_patch': {
      const patch = typeof args.input === 'string' ? args.input : typeof args.patch === 'string' ? args.patch : typeof args.raw === 'string' ? args.raw : '';
      const ops = parseApplyPatch(patch);
      if (!ops.length) return [{ ...base, category: 'file_edit' }];
      return ops.map((op, i) => ({
        id: i === 0 ? id : `${id}#${i}`,
        name: 'apply_patch',
        category: op.kind === 'create' ? ('file_write' as const) : ('file_edit' as const),
        paths: [op.moveTo ?? op.path],
        input: { op: op.kind, path: op.path, moveTo: op.moveTo },
        result: { ok: true, summary: `${op.kind} ${op.path}`, structured: { kind: op.kind, filePath: op.moveTo ?? op.path } },
      }));
    }
    case 'write_stdin':
      return [{ ...base, category: 'shell', command: typeof args.chars === 'string' ? `(stdin) ${truncate(args.chars, 80)}` : '(stdin)' }];
    case 'update_plan':
      return [{ ...base, category: 'plan' }];
    case 'web_search':
      return [{ ...base, category: 'web', description: typeof args.query === 'string' ? args.query : undefined }];
    case 'view_image':
      return [{ ...base, category: 'file_read', paths: typeof args.path === 'string' ? [args.path] : [] }];
    default:
      return [{ ...base, category: 'other' }];
  }
}

export async function parseCodexFile(filePath: string): Promise<{ draft: NormalizedDraft; light?: false }> {
  const warnings: string[] = [];
  const messages: Message[] = [];
  const toolCalls: ToolCall[] = [];
  const pending = new Map<string, ToolCall[]>();
  const counts = emptyCounts();
  const models = new Set<string>();
  let sessionId = '';
  let cwd: string | undefined;
  let startedAt: string | undefined;
  let endedAt: string | undefined;
  let cliVersion: string | undefined;
  let gitBranch: string | undefined;
  let firstPrompt: string | undefined;
  let hasUserEvent = false;
  const fallbackHumans: Message[] = [];
  let seenAssistantIds = new Set<string>();
  let lastAgentMessageText: string | undefined;

  const push = (m: Omit<Message, 'index' | 'id'> & { id?: string }): Message => {
    const msg: Message = { ...m, id: m.id ?? `${messages.length}`, index: messages.length };
    messages.push(msg);
    return msg;
  };
  const noteTs = (ts: string | undefined) => {
    const iso = toIso(ts);
    if (!iso) return;
    if (!startedAt || iso < startedAt) startedAt = iso;
    if (!endedAt || iso > endedAt) endedAt = iso;
  };

  for await (const { value } of readJsonl(filePath, { strip, warnings })) {
    const line = value as RolloutLine;
    if (!line || typeof line !== 'object' || typeof line.type !== 'string') continue;
    noteTs(line.timestamp);
    const ts = toIso(line.timestamp);
    const payload = line.payload as Record<string, unknown> | undefined;
    switch (line.type) {
      case 'session_meta': {
        const p = (payload ?? {}) as SessionMetaPayload;
        sessionId = p.id ?? p.session_id ?? sessionId;
        cwd = cwd ?? p.cwd;
        if (p.timestamp) noteTs(p.timestamp);
        cliVersion = p.cli_version ?? cliVersion;
        gitBranch = p.git?.branch ?? gitBranch;
        break;
      }
      case 'turn_context': {
        const p = (payload ?? {}) as TurnContextPayload;
        if (p.model) models.add(p.model);
        cwd = cwd ?? p.cwd;
        break;
      }
      case 'event_msg': {
        const p = (payload ?? {}) as EventMsgPayload;
        if (p.type === 'user_message') {
          const ev = p as { message?: string; images?: string[]; local_images?: string[] };
          let text = cleanCodexUserText(ev.message ?? '');
          const imgs = (ev.images?.length ?? 0) + (ev.local_images?.length ?? 0);
          if (imgs) text = text ? `${text}\n[이미지 ${imgs}장]` : `[이미지 ${imgs}장]`;
          if (!text) break;
          hasUserEvent = true;
          counts.human += 1;
          if (!firstPrompt) firstPrompt = text;
          push({ role: text.startsWith('/') ? 'slash-command' : 'human', text: text.startsWith('/') ? text.slice(1) : text, timestamp: ts, meta: text.startsWith('/') ? { commandName: text.slice(1).split(/\s+/)[0] } : undefined });
          if (text.startsWith('/')) {
            counts.human -= 1;
            counts.slashCommands += 1;
          }
        } else if (p.type === 'agent_message') {
          lastAgentMessageText = (p as { message?: string }).message;
        } else if (p.type === 'exec_command_end') {
          const ev = p as { call_id?: string; exit_code?: number; stdout?: string; stderr?: string };
          const tcs = ev.call_id ? pending.get(ev.call_id) : undefined;
          if (tcs) for (const tc of tcs) if (tc.result && typeof ev.exit_code === 'number') tc.result.ok = ev.exit_code === 0;
        }
        break;
      }
      case 'response_item': {
        const p = (payload ?? {}) as ResponseItemPayload;
        if (p.type === 'message') {
          const msg = p as { role: string; content?: unknown; id?: string };
          const text = partsText(msg.content as never);
          if (msg.role === 'user') {
            const cleaned = cleanCodexUserText(text);
            if (!cleaned) break;
            const m: Omit<Message, 'index' | 'id'> = { role: 'human', text: cleaned, timestamp: ts };
            if (!hasUserEvent) fallbackHumans.push({ ...m, id: `fb-${fallbackHumans.length}`, index: -1 });
          } else if (msg.role === 'assistant') {
            if (!text.trim()) break;
            const key = msg.id ?? `${messages.length}`;
            if (seenAssistantIds.has(key)) break;
            seenAssistantIds.add(key);
            counts.assistant += 1;
            push({ role: 'assistant', text, timestamp: ts });
          } else if (msg.role === 'developer' || msg.role === 'system') {
            push({ role: 'system-injected', text: truncate(text, 300), timestamp: ts });
          }
        } else if (p.type === 'function_call' || p.type === 'custom_tool_call') {
          const fc = p as { name: string; arguments?: string; input?: string; call_id?: string; id?: string };
          const id = fc.call_id ?? fc.id ?? `call-${toolCalls.length}`;
          const args = p.type === 'custom_tool_call' ? { input: fc.input ?? '' } : parseArgs(fc.arguments);
          const tcs = mapCodexTool(id, fc.name, args);
          for (const tc of tcs) {
            counts.toolCalls += 1;
            tc.timestamp = ts;
            const m = push({ role: 'tool_use', toolCall: tc, timestamp: ts });
            tc.messageIndex = m.index;
            toolCalls.push(tc);
          }
          pending.set(id, tcs);
        } else if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
          const out = p as { call_id?: string; output?: unknown };
          const tcs = out.call_id ? pending.get(out.call_id) : undefined;
          let text = '';
          let ok = true;
          if (typeof out.output === 'string') {
            text = out.output;
            const m = /exit(?: code)?[:=]?\s*(\d+)/i.exec(text.slice(0, 200));
            if (m && Number(m[1]) !== 0) ok = false;
          } else if (out.output && typeof out.output === 'object') {
            const o = out.output as { content?: string; success?: boolean; exit_code?: number };
            text = o.content ?? '';
            if (o.success === false || (typeof o.exit_code === 'number' && o.exit_code !== 0)) ok = false;
          }
          if (tcs) {
            for (const tc of tcs) {
              if (tc.category === 'shell') tc.result = { ok, summary: truncate(text, 300), structured: { stdout: truncate(text, 4000), stderr: '' } };
              else if (!tc.result) tc.result = { ok, summary: truncate(text, 300) };
              else tc.result.ok = ok && tc.result.ok;
            }
            pending.delete(out.call_id ?? '');
          }
          push({ role: 'tool_result', toolUseId: out.call_id, text: truncate(text, 2000), isError: !ok, timestamp: ts });
        } else if (p.type === 'local_shell_call') {
          const sc = p as { call_id?: string; id?: string; action?: { command?: string[] } };
          const id = sc.call_id ?? sc.id ?? `shell-${toolCalls.length}`;
          const tc: ToolCall = { id, name: 'local_shell', category: 'shell', command: sc.action?.command?.join(' '), paths: [], input: sc.action ?? {}, timestamp: ts };
          counts.toolCalls += 1;
          const m = push({ role: 'tool_use', toolCall: tc, timestamp: ts });
          tc.messageIndex = m.index;
          toolCalls.push(tc);
          pending.set(id, [tc]);
        } else if (p.type === 'web_search_call') {
          const ws = p as { id?: string; action?: { query?: string } };
          const tc: ToolCall = { id: ws.id ?? `web-${toolCalls.length}`, name: 'web_search', category: 'web', description: ws.action?.query, paths: [], input: ws.action ?? {}, timestamp: ts };
          counts.toolCalls += 1;
          const m = push({ role: 'tool_use', toolCall: tc, timestamp: ts });
          tc.messageIndex = m.index;
          toolCalls.push(tc);
        }
        break;
      }
      case 'compacted':
        push({ role: 'system-injected', text: '컨텍스트가 요약(compaction)되었습니다', timestamp: ts, meta: { subtype: 'compacted' } });
        break;
      default:
        break;
    }
  }

  if (!hasUserEvent && fallbackHumans.length) {
    // event_msg 가 없는 옛 형식: response_item 의 user 메시지를 시간 순서대로 끼워 넣는다
    const merged: Message[] = [];
    let fi = 0;
    for (const m of messages) {
      while (fi < fallbackHumans.length && (fallbackHumans[fi]?.timestamp ?? '') <= (m.timestamp ?? '') && (fallbackHumans[fi]?.timestamp)) {
        merged.push(fallbackHumans[fi] as Message);
        fi += 1;
      }
      merged.push(m);
    }
    while (fi < fallbackHumans.length) merged.push(fallbackHumans[fi++] as Message);
    messages.length = 0;
    merged.forEach((m, i) => {
      m.index = i;
      if (m.toolCall) m.toolCall.messageIndex = i;
      messages.push(m);
    });
    counts.human = fallbackHumans.length;
    firstPrompt = fallbackHumans[0]?.text;
  }
  if (!messages.some((m) => m.role === 'assistant') && lastAgentMessageText) {
    counts.assistant += 1;
    push({ role: 'assistant', text: lastAgentMessageText });
  }

  const draft: NormalizedDraft = {
    sessionId: sessionId || path.basename(filePath, '.jsonl'),
    title: truncate(firstPrompt ?? '(제목 없음)', 60),
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
    toolVersion: cliVersion,
    messages,
    toolCalls,
    parseWarnings: warnings,
  };
  return { draft };
}
