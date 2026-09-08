import type { ContentBlock, SystemRecord, UserRecord } from './records';

export type UserClass =
  | { kind: 'tool_result' }
  | { kind: 'skip' }
  | { kind: 'system-injected'; text: string }
  | { kind: 'interrupt'; text: string }
  | { kind: 'slash-command'; name: string; args?: string; text: string }
  | { kind: 'human'; text: string; openedFiles: string[]; hasImage: boolean };

const IDE_OPEN_RE = /^<ide_opened_file>/;
const IDE_PATH_RE = /opened the file (\S+?) in the IDE/;
const COMMAND_RE = /^<command-message>/;
const COMMAND_NAME_RE = /<command-name>([\s\S]*?)<\/command-name>/;
const COMMAND_ARGS_RE = /<command-args>([\s\S]*?)<\/command-args>/;
const INJECTED_RE = /^<(local-command|task-notification|system-reminder|command-stdout|command-stderr)/;
const INTERRUPT_RE = /^\[Request interrupted/;

/**
 * Claude Code `type:"user"` 레코드를 사람 입력 / 도구 결과 / 주입 메시지 등으로 분류한다.
 * 순수 함수. 실측한 모든 합성 레코드 유형을 다룬다.
 */
export function classifyUserRecord(rec: UserRecord): UserClass {
  const content = rec.message?.content;
  if (rec.toolUseResult != null) return { kind: 'tool_result' };
  if (Array.isArray(content) && content.some((b) => b && (b as ContentBlock).type === 'tool_result')) {
    return { kind: 'tool_result' };
  }
  if (rec.isSidechain === true) return { kind: 'skip' };
  if (rec.isMeta === true) {
    return { kind: 'system-injected', text: contentText(content) };
  }

  let text: string;
  const openedFiles: string[] = [];
  let hasImage = false;
  if (typeof content === 'string') {
    text = content;
  } else if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const block of content) {
      if (!block || typeof block !== 'object') continue;
      const b = block as ContentBlock;
      if (b.type === 'text') {
        const t = (b as { text?: string }).text ?? '';
        if (IDE_OPEN_RE.test(t)) {
          const m = IDE_PATH_RE.exec(t);
          if (m?.[1]) openedFiles.push(m[1]);
          continue;
        }
        parts.push(t);
      } else if (b.type === 'image') {
        hasImage = true;
      }
    }
    text = parts.join('\n');
    if (hasImage) text = text ? `${text}\n[이미지 첨부]` : '[이미지 첨부]';
  } else {
    return { kind: 'skip' };
  }

  const trimmed = text.trim();
  if (!trimmed) return { kind: 'skip' };
  if (COMMAND_RE.test(trimmed)) {
    const name = COMMAND_NAME_RE.exec(trimmed)?.[1]?.trim() ?? '';
    const args = COMMAND_ARGS_RE.exec(trimmed)?.[1]?.trim();
    return { kind: 'slash-command', name, args, text: args ? `${name} ${args}` : name };
  }
  if (INJECTED_RE.test(trimmed)) return { kind: 'system-injected', text: trimmed };
  if (INTERRUPT_RE.test(trimmed)) return { kind: 'interrupt', text: trimmed };
  return { kind: 'human', text: trimmed, openedFiles, hasImage };
}

export type SystemClass =
  | { kind: 'human'; text: string }
  | { kind: 'system-injected'; text: string; subtype: string; isError: boolean }
  | { kind: 'skip' };

/** `type:"system"` 레코드. `/`로 시작한 미지의 명령 원문은 local_command 로 저장되므로 사람 입력으로 복구한다. */
export function classifySystemRecord(rec: SystemRecord): SystemClass {
  const subtype = rec.subtype ?? '';
  const content = typeof rec.content === 'string' ? rec.content : '';
  if (subtype === 'local_command') {
    const trimmed = content.trim();
    if (!trimmed) return { kind: 'skip' };
    if (/^<local-command-(stdout|stderr)>/.test(trimmed)) {
      return { kind: 'system-injected', text: trimmed, subtype, isError: false };
    }
    return { kind: 'human', text: trimmed };
  }
  if (subtype === 'api_error') {
    const msg = rec.error?.message ?? content ?? 'API error';
    return { kind: 'system-injected', text: msg, subtype, isError: true };
  }
  return { kind: 'skip' };
}

export function contentText(content: string | ContentBlock[] | undefined): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map((b) => (b && (b as { type?: string }).type === 'text' ? ((b as { text?: string }).text ?? '') : ''))
    .filter(Boolean)
    .join('\n');
}
