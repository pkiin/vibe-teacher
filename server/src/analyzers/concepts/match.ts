import type { BuiltSummary, ConceptHit, Evidence, NormalizedSession } from '@vibe-teacher/shared';
import { truncate } from '../../lib/text';
import type { CompiledConcept } from './dictionary';

interface Hit {
  weight: number;
  evidence: Evidence;
  kind: 'file' | 'command' | 'package' | 'text' | 'stack';
}

function textSnippet(text: string, re: RegExp): string {
  const m = re.exec(text);
  if (!m) return truncate(text, 80);
  const start = Math.max(0, m.index - 30);
  const end = Math.min(text.length, m.index + m[0].length + 40);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).replace(/\s+/g, ' ')}${end < text.length ? '…' : ''}`;
}

export function matchConcepts(session: NormalizedSession, built: BuiltSummary, dictionary: CompiledConcept[], limit = 20): ConceptHit[] {
  const files = [...built.filesCreated, ...built.filesModified, ...built.filesDeleted];
  const texts: { index: number; text: string; role: string }[] = session.messages
    .filter((m) => (m.role === 'human' || m.role === 'assistant') && m.text && !m.meta?.subagentId)
    .map((m) => ({ index: m.index, text: m.text ?? '', role: m.role }));

  const hits: ConceptHit[] = [];
  for (const c of dictionary) {
    const found: Hit[] = [];
    for (const f of files) {
      const target = f.relPath ?? f.path;
      if (c.re.files.some((re) => re.test(target))) {
        found.push({ weight: 1, kind: 'file', evidence: { snippet: target, toolCallId: f.evidence[0]?.toolCallId, messageIndex: f.evidence[0]?.messageIndex } });
      }
    }
    for (const cmd of built.commandsRun) {
      if (c.re.commands.some((re) => re.test(cmd.command))) {
        found.push({ weight: 1, kind: 'command', evidence: { snippet: cmd.command, toolCallId: cmd.evidence[0]?.toolCallId, messageIndex: cmd.evidence[0]?.messageIndex } });
      }
    }
    for (const p of built.packagesInstalled) {
      if (c.re.packages.some((re) => re.test(p.name))) {
        found.push({ weight: 1, kind: 'package', evidence: { snippet: `${p.manager}: ${p.name}`, toolCallId: p.evidence[0]?.toolCallId, messageIndex: p.evidence[0]?.messageIndex } });
      }
    }
    for (const s of built.stack) {
      if (c.re.stack.some((re) => re.test(s.id) || re.test(s.name))) {
        found.push({ weight: 0.75, kind: 'stack', evidence: { snippet: `기술 스택: ${s.name}` } });
      }
    }
    let textHits = 0;
    for (const t of texts) {
      for (const re of c.re.text) {
        if (!re.test(t.text)) continue;
        textHits += 1;
        if (textHits <= 3) found.push({ weight: t.role === 'human' ? 0.6 : 0.4, kind: 'text', evidence: { snippet: textSnippet(t.text, re), messageIndex: t.index } });
        break;
      }
    }
    if (!found.length) continue;
    const perKind = new Map<string, number>();
    let scoreRaw = 0;
    for (const h of found) {
      const n = perKind.get(h.kind) ?? 0;
      if (n >= 3) continue;
      perKind.set(h.kind, n + 1);
      scoreRaw += h.weight;
    }
    const score = Math.round(scoreRaw * 100) / 100;
    if (score < 1) continue;
    const dedup = new Map<string, Hit>();
    for (const h of found) if (!dedup.has(h.evidence.snippet)) dedup.set(h.evidence.snippet, h);
    const evidence = Array.from(dedup.values()).slice(0, 6);
    hits.push({
      id: c.id,
      name: c.name,
      category: c.category,
      level: c.level,
      explanation: c.explanation,
      whyHere: renderWhyHere(c, evidence),
      contextKind: evidence.some((h) => h.kind !== 'text') ? 'activity' : 'mention',
      score,
      evidence: evidence.map((h) => h.evidence),
      links: c.links,
    });
  }
  const levelOrder = { beginner: 0, intermediate: 1 };
  return hits.sort((a, b) => b.score - a.score || levelOrder[a.level] - levelOrder[b.level]).slice(0, limit);
}

function renderWhyHere(c: CompiledConcept, hits: Hit[]): string {
  const files = hits.filter((h) => h.kind === 'file').map((h) => h.evidence.snippet);
  const commands = hits.filter((h) => h.kind === 'command').map((h) => h.evidence.snippet);
  const packages = hits.filter((h) => h.kind === 'package').map((h) => h.evidence.snippet.replace(/^[^:]+: /, ''));
  const stack = hits.filter((h) => h.kind === 'stack').map((h) => h.evidence.snippet.replace(/^기술 스택: /, ''));
  const list = (arr: string[], n = 3) => arr.slice(0, n).map((s) => `‘${truncate(s, 60)}’`).join(', ') + (arr.length > n ? ` 외 ${arr.length - n}개` : '');
  if (c.whyHereTemplate) {
    return c.whyHereTemplate
      .replace('{files}', files.length ? list(files) : '(파일 없음)')
      .replace('{commands}', commands.length ? list(commands) : '(명령 없음)')
      .replace('{packages}', packages.length ? list(packages) : '(패키지 없음)')
      .replace('{textHits}', `‘${c.name}’ 관련 대화`);
  }
  // 발췌문은 근거 목록에만 둔다. 본문은 확인한 사실 한 가지와 알아둘 이유를 잇는다.
  let context: string;
  if (files[0]) context = `${files[0]} 파일의 변경 기록이 있습니다.`;
  else if (commands[0]) context = commands[0].length <= 80 ? `${commands[0]} 명령을 실행한 기록이 있습니다.` : '관련 명령을 실행한 기록이 있습니다.';
  else if (packages[0]) context = `${packages[0]} 패키지를 설치한 기록이 있습니다.`;
  else if (stack[0]) context = `이 작업의 도구·기술 목록에 ${stack[0]}가 있습니다.`;
  else context = `대화에서 ‘${c.name}’ 관련 내용이 나왔습니다. 실제 사용 여부는 확인되지 않았습니다.`;
  return c.whyItMatters ? `${context} ${c.whyItMatters}` : context;
}
