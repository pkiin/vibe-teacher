import type { SessionMetaPayload } from './records';

/** 내부 검토·위임 세션의 user 역할은 사람의 직접 입력이 아니다. */
export function isCodexSubagentSession(meta: SessionMetaPayload): boolean {
  const source = meta.source;
  return !!meta.parent_thread_id
    || source === 'subagent'
    || (!!source && typeof source === 'object' && 'subagent' in source);
}

const WRAPPER_TAGS = [
  'environment_context', 'user_instructions', 'permissions[ _]instructions', 'turn_context', 'AGENTS\\.md',
  'INSTRUCTIONS', 'skills_instructions', 'collaboration_mode', 'subagent_notification', 'collab_message',
  'task[_-]notification', 'external_codex_apps_open_page', 'system-reminder', 'turn_aborted',
];
const OPEN_WRAPPER = new RegExp(`^[ \\t]{0,3}<(${WRAPPER_TAGS.join('|')})(?:\\s[^>]*)?>`, 'i');

/** 알려진 자동 문맥만 지우고 코드 예제와 요청 본문은 보존한다. */
export function cleanCodexUserText(text: string): string {
  const kept: string[] = [];
  let closingTag: string | undefined;
  let fence: { char: string; length: number } | undefined;
  const lines = text.trim().split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    let line = lines[i] ?? '';
    if (closingTag) {
      const end = line.toLowerCase().indexOf(closingTag);
      if (end < 0) continue;
      line = line.slice(end + closingTag.length);
      closingTag = undefined;
    }
    const fenceMatch = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      kept.push(line);
      if (fenceMatch?.[1]?.[0] === fence.char && fenceMatch[1].length >= fence.length && !fenceMatch[2]?.trim()) fence = undefined;
      continue;
    }
    if (fenceMatch?.[1]) {
      fence = { char: fenceMatch[1][0] ?? '`', length: fenceMatch[1].length };
      kept.push(line);
      continue;
    }
    if (/^# AGENTS\.md instructions for .+$/i.test(line)) {
      const next = lines.slice(i + 1).find((part) => part.trim());
      if (next?.trim().startsWith('<INSTRUCTIONS>')) continue;
    }
    while (true) {
      const open = OPEN_WRAPPER.exec(line);
      if (!open?.[1]) break;
      const close = `</${open[1].toLowerCase()}>`;
      const end = line.toLowerCase().indexOf(close, open[0].length);
      if (end < 0) {
        closingTag = close;
        line = '';
        break;
      }
      line = line.slice(end + close.length).trimStart();
    }
    kept.push(line);
  }
  const cleaned = kept.join('\n').trim();
  if (/^# Context from my IDE setup:\s*\n/.test(cleaned)) {
    const request = /^## My request:[ \t]*\r?\n/m.exec(cleaned);
    return request ? cleaned.slice(request.index + request[0].length).trim() : '';
  }
  return cleaned;
}
