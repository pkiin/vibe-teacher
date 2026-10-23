import type { BuiltSummary, ConceptHit, NormalizedSession } from '@vibe-teacher/shared';
import { truncate } from '../lib/text';
import { extractUserMessages } from '../analyzers/user-messages';

const SECRET_PATTERNS: RegExp[] = [
  /-----BEGIN ([A-Z ]*PRIVATE KEY)-----[\s\S]*?-----END \1-----/g,
  /sk-[A-Za-z0-9_-]{16,}/g,
  /sk-ant-[A-Za-z0-9_-]{16,}/g,
  /ghp_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /AKIA[0-9A-Z]{16}/g,
  /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g,
  /(?<=(?:KEY|TOKEN|SECRET|PASSWORD|PASS|PWD)[A-Z_]*\s*[=:]\s*["']?)[^\s"']{8,}/gi,
  /(?<=Bearer\s+)[A-Za-z0-9._-]{16,}/g,
];

export function maskSecrets(text: string): string {
  let out = text;
  for (const re of SECRET_PATTERNS) out = out.replace(re, (match) => `***${'\n'.repeat((match.match(/\n/g) ?? []).length)}`);
  return out;
}

export interface DigestOptions {
  maxChars?: number;
  maxUserMessages?: number;
  maxUserMessageChars?: number;
}

/** LLM 에 보낼 압축 다이제스트. 원본 JSONL 이나 도구 출력 전문은 절대 포함하지 않는다. */
export function buildDigest(session: NormalizedSession, built: BuiltSummary, concepts: ConceptHit[], opts: DigestOptions = {}): string {
  const maxChars = opts.maxChars ?? 35_000;
  const maxUser = opts.maxUserMessages ?? 80;
  const maxUserChars = opts.maxUserMessageChars ?? 500;
  const lines: string[] = [];
  const push = (s: string) => lines.push(s);

  push('## 세션 정보');
  push(`- 도구: ${session.provider}${session.toolVersion ? ` ${session.toolVersion}` : ''}`);
  push(`- 프로젝트 폴더: ${session.projectRoot}`);
  push(`- 기간: ${session.startedAt ?? '?'} ~ ${session.endedAt ?? '?'}${built.stats.durationMin != null ? ` (약 ${built.stats.durationMin}분)` : ''}`);
  push(`- 모델: ${session.models.join(', ') || '?'}`);
  push(`- 사용자 메시지 ${session.counts.human}개, 도구 호출 ${built.stats.toolCalls}개, 오류/실패 ${built.stats.errors}건`);

  push('\n## 사용자가 입력한 메시지 (시간 순)');
  const um = extractUserMessages(session).items;
  const selected = um.length > maxUser ? [...um.slice(0, maxUser / 2), null, ...um.slice(-maxUser / 2)] : um;
  let n = 0;
  for (const item of selected) {
    if (item === null) {
      push(`… (중간 ${um.length - maxUser}개 생략) …`);
      continue;
    }
    n += 1;
    const prefix = item.kind === 'slash-command' ? '[슬래시 명령] ' : '';
    push(`${n}. ${prefix}${truncate(item.text.replace(/\s+/g, ' '), maxUserChars)}${item.interruptedNext ? ' [사용자가 중단함]' : ''}`);
  }

  push('\n## 규칙 기반으로 뽑은 사실');
  const fileLine = (f: { relPath?: string; path: string; via: string }) => `- ${f.relPath ?? f.path}${f.via === 'shell' ? ' (셸 명령으로)' : ''}`;
  if (built.filesCreated.length) {
    push(`### 생성된 파일 (${built.filesCreated.length})`);
    built.filesCreated.slice(0, 40).forEach((f) => push(fileLine(f)));
  }
  if (built.filesModified.length) {
    push(`### 수정된 파일 (${built.filesModified.length})`);
    built.filesModified.slice(0, 40).forEach((f) => push(fileLine(f)));
  }
  if (built.filesDeleted.length) {
    push(`### 삭제된 파일 (${built.filesDeleted.length})`);
    built.filesDeleted.slice(0, 20).forEach((f) => push(fileLine(f)));
  }
  if (built.packagesInstalled.length) {
    push('### 설치한 패키지');
    push(built.packagesInstalled.map((p) => `${p.name}${p.dev ? '(dev)' : ''} [${p.manager}]`).join(', '));
  }
  if (built.gitCommits.length || built.gitInitialized) {
    push('### Git');
    if (built.gitInitialized) push('- git init 실행');
    built.gitCommits.forEach((c) => push(`- 커밋${c.hash ? ` ${c.hash.slice(0, 7)}` : ''}: ${c.message ?? '(메시지 미상)'}${c.pushed ? ' (push 됨)' : ''}`));
  }
  const byCat = new Map<string, string[]>();
  for (const c of built.commandsRun) {
    if (c.category === 'inspect' || c.category === 'other') continue;
    const arr = byCat.get(c.category) ?? [];
    if (arr.length < 12) arr.push(`${c.command}${c.failed ? ` (실패 ${c.failed}회)` : ''}`);
    byCat.set(c.category, arr);
  }
  if (byCat.size) {
    push('### 실행한 명령 (종류별)');
    for (const [cat, arr] of byCat) push(`- ${cat}: ${arr.join(' | ')}`);
  }
  if (built.serversStarted.length) push(`### 띄운 서버: ${built.serversStarted.map((s) => `${s.command}${s.port ? ` (포트 ${s.port})` : ''}`).join(' | ')}`);
  if (built.stack.length) push(`### 기술 스택: ${built.stack.map((s) => s.name).join(', ')}`);

  push('\n## 타임라인 (사용자 지시 → 결과)');
  built.timeline.slice(0, 60).forEach((g, i) => {
    const files = g.filesTouched.length ? `파일 ${g.filesTouched.length}개` : '';
    const tools = g.toolCallIds.length ? `도구 ${g.toolCallIds.length}회` : '';
    const tail = g.finalAssistantText ? ` → 마지막 답변: ${truncate(g.finalAssistantText.replace(/\s+/g, ' '), 200)}` : '';
    push(`${i + 1}. "${truncate(g.promptText.replace(/\s+/g, ' '), 120)}" [${[tools, files].filter(Boolean).join(', ') || '도구 없음'}]${g.interrupted ? ' [중단]' : ''}${tail}`);
  });

  if (concepts.length) {
    push('\n## 규칙 기반 개념 후보 (id · 이름 · 근거)');
    concepts.slice(0, 20).forEach((c) => {
      push(`- ${c.id} · ${c.name}`);
      const context = c.contextKind === 'mention' ? '대화에서 언급됨. 실제 사용·실행은 미확인' : c.contextKind === 'activity' ? '파일·명령 등 작업 기록' : '제공된 기록에서 실제 사용 여부를 따로 확인해야 함';
      push(`  - 연결 근거: ${context}`);
      push(`  - 알아둘 이유: ${c.whyHere}`);
    });
  }

  let text = maskSecrets(lines.join('\n'));
  if (text.length > maxChars) text = truncate(text, maxChars) + '\n(자료가 길어 뒷부분을 생략했습니다)';
  return text;
}
