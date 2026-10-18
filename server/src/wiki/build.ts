import path from 'node:path';
import {
  WIKI_SCHEMA_VERSION,
  type BuiltSummary,
  type ConceptHit,
  type EvidenceRef,
  type EvidenceSourceKind,
  type FileFact,
  type KnowledgeItem,
  type Message,
  type NormalizedSession,
  type ProjectClaim,
  type RiskFinding,
  type ToolCall,
  type WikiCoverage,
  type WikiSnapshot,
} from '@vibe-teacher/shared';
import { collectCommandFacts } from '../analyzers/built/commands';
import { sha1, shortId } from '../lib/hash';
import { truncate } from '../lib/text';
import { maskSecrets } from '../llm/digest';

/**
 * 세션 기록 → 프로젝트 평면 위키 원장 (규칙 기반, 결정적).
 * - 사실(claim)은 근거 ID 로만 출처를 잇는다. ID 는 코드가 만들고 재빌드해도 같다.
 * - "보이지 않음"은 이 세션 기록 범위 안의 해석(inference)으로만 쓰고, 저장소 전체의 부재로 단정하지 않는다.
 * - 위험(finding)은 사용자 상태를 보지 않고 만든다. 개인화는 plan.ts 가 설명 깊이에만 반영한다.
 * - 에이전트의 완료 보고(agent_reported)와 실제 실행 기록(observed_artifact)을 섞지 않는다.
 * - 이 단계는 사용자 이해 증거를 만들지 않는다 (learner_modeling 허용 전에는 개인 증거를 추출하지 않음).
 */
export const RULES_VERSION = 'rules-0.1';

export function snapshotRevision(s: { key: string; fileSize: number; fileMtime: number }): string {
  return `s_${shortId(`${s.key}|${s.fileSize}|${s.fileMtime}`, 16)}`;
}

const SESSION_SCOPE = '이 세션 기록 안에서만 확인한 내용입니다';
const NOT_FOUND_SCOPE = '이 세션 기록에서 찾지 못했다는 뜻이며, 세션 밖에서 한 작업은 알 수 없습니다';

const ENV_FILE_RE = /^\.env(\.(local|development|production|test|dev|prod))?$/;
const ACCESS_PATH_RE = /(^|[/._-])(auth|login|logout|signin|signup|session|sessions|admin|permission|permissions|role|roles|rbac|acl|guard|guards|policy|policies|middleware)([/._-]|$)/i;
const ACCESS_TEXT_RE = /(관리자|어드민|권한|\badmin\b|\brole\b|permission)/i;
const API_PATH_RE = /(^|\/)(api|routes?|server|controllers?|handlers?|endpoints?)(\/|\.|$)/i;
const PERSIST_TEXT_RE = /(사라(져|졌|지|짐)|없어(져|졌)|새로\s?고침|저장(이|도)?\s?안|날아(가|갔)|유지(가)?\s?안|disappear|not\s+(saved|persist))/i;
const COMPLETE_RE = /(완료(했|하였|되었|됐)|구현(했|하였)습니다|끝났습니다|마쳤습니다|모두 통과|통과했습니다|all tests pass|tests? (are )?passing|successfully (implemented|completed)|is (now )?complete\b|\bdone\b)/i;
const TEST_CLAIM_RE = /(테스트[^.\n]{0,24}(통과|성공)|tests? (all )?pass|passing tests|tests? (are )?passing)/i;
const STRONG_SECRET_RE = /sk-[A-Za-z0-9_-]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/;
/** 환경 변수 형태(대문자 이름)에 16자 이상, 영문과 숫자가 섞인 값만 의심한다 — 코드의 keys=set() 같은 오탐을 줄이기 위해 */
const WEAK_SECRET_RE = /\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD)[A-Z0-9_]*\s*[=:]\s*["']?([A-Za-z0-9_\-+/]{16,})|Bearer\s+([A-Za-z0-9._-]{20,})/g;
const PUBLIC_BIND_RE = /0\.0\.0\.0|--host(\s*$|\s+-|=0|\s+0|\s+::|=::)/;
const LLM_PACKAGE_RE = /^(openai|@anthropic-ai\/sdk|anthropic|@google\/generative-ai|@google\/genai|google-generativeai|google-genai|cohere|cohere-ai|groq-sdk|groq|@mistralai\/.+|mistralai|langchain|@langchain\/.+|ai)$/;
const BENIGN_RM_RE = /(^|\/)(node_modules|dist|build|out|\.next|\.nuxt|\.cache|coverage|__pycache__|\.pytest_cache|\.venv|venv|tmp|\.turbo|\.parcel-cache)\/?$/;
const DESTRUCTIVE_RES: { re: RegExp; label: string }[] = [
  { re: /\bgit\s+reset\s+--hard\b/, label: 'git reset --hard' },
  { re: /\bgit\s+push\b[^\n;&|]*\s(--force\b|-f\b|--force-with-lease\b)/, label: 'git push --force' },
  { re: /\bgit\s+clean\s+-[a-zA-Z]*f/, label: 'git clean -f' },
  { re: /\b(DROP\s+(TABLE|DATABASE|SCHEMA)|TRUNCATE\s+TABLE)\b/i, label: 'DROP/TRUNCATE' },
  { re: /\bprisma\s+migrate\s+reset\b/, label: 'prisma migrate reset' },
  { re: /\bdb:drop\b/, label: 'db:drop' },
];

export interface BuildInput {
  session: NormalizedSession;
  built: BuiltSummary;
  concepts: ConceptHit[];
  catalogVersion: string;
  /** 위키 개념 카탈로그에 있는 ID (없는 개념은 지식 항목에 넣지 않는다) */
  conceptIds: ReadonlySet<string>;
  now?: Date;
}

export function secretKind(text: string): 'strong' | 'weak' | null {
  if (STRONG_SECRET_RE.test(text)) return 'strong';
  for (const m of text.matchAll(WEAK_SECRET_RE)) {
    const v = m[1] ?? m[2] ?? '';
    if (/\d/.test(v) && /[A-Za-z]/.test(v) && !/^(your|example|changeme|placeholder|dummy|test)/i.test(v)) return 'weak';
  }
  return null;
}

export interface EvidenceWhere {
  messageIndex?: number;
  toolCallId?: string;
  label?: string;
  timestamp?: string;
  focusMasked?: boolean;
}

/** 근거 하나. ID 는 세션·위치·원문 해시로 정해지므로 같은 원문이면 늘 같은 ID 가 나온다. 발췌는 비밀값을 가린다. */
export function makeEvidence(sessionKey: string, sourceKind: EvidenceSourceKind, raw: string, where: EvidenceWhere): EvidenceRef {
  const text = raw ?? '';
  const id = `ev_${shortId(`${sessionKey}|${sourceKind}|${where.toolCallId ?? ''}|${where.messageIndex ?? ''}|${sha1(text)}`, 14)}`;
  const parts = [where.messageIndex !== undefined ? `메시지 #${where.messageIndex}` : null, where.label ?? null].filter(Boolean);
  return {
    id,
    sessionKey,
    sourceKind,
    ...(where.messageIndex !== undefined ? { messageIndex: where.messageIndex } : {}),
    ...(where.toolCallId ? { toolCallId: where.toolCallId } : {}),
    locator: parts.join(' · ') || '세션 기록',
    excerpt: excerptOf(maskSecrets(text), where.focusMasked ?? false),
    contentHash: sha1(text),
    ...(where.timestamp ? { timestamp: where.timestamp } : {}),
  };
}

class SnapshotBuilder {
  readonly evidence = new Map<string, EvidenceRef>();
  readonly claims = new Map<string, ProjectClaim>();
  readonly findings = new Map<string, RiskFinding>();
  readonly items = new Map<string, KnowledgeItem>();
  readonly warnings: string[] = [];
  private readonly tcById: Map<string, ToolCall>;

  constructor(
    readonly session: NormalizedSession,
    readonly revision: string,
    private readonly conceptIds: ReadonlySet<string>,
  ) {
    this.tcById = new Map(session.toolCalls.map((tc) => [tc.id, tc]));
  }

  ev(sourceKind: EvidenceSourceKind, raw: string, where: EvidenceWhere): string {
    const e = makeEvidence(this.session.key, sourceKind, raw, where);
    if (!this.evidence.has(e.id)) this.evidence.set(e.id, e);
    return e.id;
  }

  toolEv(tc: ToolCall, raw?: string, focusMasked = false): string {
    return this.ev('tool_call', raw ?? tc.command ?? `${tc.name} ${tc.paths.join(' ')}`, { messageIndex: tc.messageIndex, toolCallId: tc.id, label: tc.name, timestamp: tc.timestamp, focusMasked });
  }

  resultEv(tc: ToolCall): string | null {
    const r = tc.result;
    if (!r) return null;
    const s = r.structured;
    const tail = s && 'stdout' in s ? `${s.stdout}\n${s.stderr}`.trim().split('\n').slice(-6).join('\n') : r.summary;
    if (!tail) return null;
    return this.ev('tool_result', tail, { messageIndex: tc.messageIndex, toolCallId: tc.id, label: `${tc.name} 결과`, timestamp: tc.timestamp });
  }

  messageEv(m: Message, focusMasked = false): string {
    return this.ev(m.role === 'human' ? 'human_message' : 'assistant_message', m.text ?? '', { messageIndex: m.index, label: m.role === 'human' ? '사용자' : '에이전트', timestamp: m.timestamp, focusMasked });
  }

  factEv(f: { evidence: { toolCallId?: string; messageIndex?: number; snippet: string }[] }, max = 2): string[] {
    const ids: string[] = [];
    for (const e of f.evidence.slice(0, max)) {
      const tc = e.toolCallId ? this.tcById.get(e.toolCallId) : undefined;
      if (tc) ids.push(this.toolEv(tc, e.snippet));
      else if (e.messageIndex !== undefined) ids.push(this.ev('tool_call', e.snippet, { messageIndex: e.messageIndex }));
    }
    return ids;
  }

  claim(key: string, c: Omit<ProjectClaim, 'id' | 'validAt' | 'limits'> & { limits?: string[] }): string {
    const id = `c_${key}`;
    this.claims.set(id, { id, validAt: this.revision, limits: c.limits ?? [SESSION_SCOPE], statement: c.statement, kind: c.kind, support: c.support, evidenceIds: [...new Set(c.evidenceIds)], origin: 'rule' });
    return id;
  }

  finding(f: Omit<RiskFinding, 'id' | 'lifecycle' | 'ruleVersion'> & { ruleVersion?: number }): string {
    const id = `f_${f.ruleId.replace(/[^a-z0-9-]/g, '-')}`;
    this.findings.set(id, { ...f, id, ruleVersion: f.ruleVersion ?? 1, lifecycle: 'open', relatedConceptIds: f.relatedConceptIds.filter((c) => this.conceptIds.has(c)) });
    return id;
  }

  item(key: string, i: Omit<KnowledgeItem, 'id'>): string {
    const id = `i_${key}`;
    const existing = this.items.get(id);
    const conceptIds = i.conceptIds.filter((c) => this.conceptIds.has(c));
    if (existing) {
      existing.claimIds = [...new Set([...existing.claimIds, ...i.claimIds])];
      existing.findingIds = [...new Set([...existing.findingIds, ...i.findingIds])];
      existing.actions = [...new Set([...existing.actions, ...i.actions])];
      existing.unverified = [...new Set([...existing.unverified, ...i.unverified])];
      existing.conceptIds = [...new Set([...existing.conceptIds, ...conceptIds])];
    } else this.items.set(id, { ...i, id, conceptIds, origin: 'rule' });
    return id;
  }
}

/** 공백을 줄이고 240자로 자른다. focusMasked 면 가려진 부분(***) 주변을 보여 준다. */
function excerptOf(masked: string, focusMasked: boolean): string {
  const flat = masked.replace(/\s+/g, ' ').trim();
  const at = focusMasked ? flat.indexOf('***') : -1;
  if (at < 120) return truncate(flat, 240);
  return `…${truncate(flat.slice(at - 100), 239)}`;
}

const names = (files: FileFact[], max = 6) => {
  const list = files.slice(0, max).map((f) => f.relPath ?? path.basename(f.path));
  return files.length > max ? `${list.join(', ')} 외 ${files.length - max}개` : list.join(', ');
};

export function buildWikiSnapshot(input: BuildInput): WikiSnapshot {
  const { session, built, concepts } = input;
  const revision = snapshotRevision(session);
  const b = new SnapshotBuilder(session, revision, input.conceptIds);
  const order = new Map(session.toolCalls.map((tc, i) => [tc.id, i]));
  const commands = collectCommandFacts(session).classified;
  const humans = session.messages.filter((m) => m.role === 'human' && m.text && !m.meta?.subagentId);
  const changed = [...built.filesCreated, ...built.filesModified, ...built.filesDeleted];

  // ---- 마지막 변경 시점 (도구 호출 순서 기준) ----
  let lastChange = -1;
  for (const tc of session.toolCalls) {
    if ((tc.category === 'file_write' || tc.category === 'file_edit') && tc.result?.ok !== false) lastChange = Math.max(lastChange, order.get(tc.id) ?? -1);
  }
  for (const x of commands) if (x.c.category === 'file' || x.c.category === 'scaffold') lastChange = Math.max(lastChange, order.get(x.tc.id) ?? -1);

  // ---- 사용자 요청 ----
  const firstHuman = humans[0];
  if (firstHuman) {
    b.claim('user-request', { statement: `사용자 요청(첫 메시지): "${truncate(maskSecrets(firstHuman.text ?? ''), 120)}"`, kind: 'observed_artifact', support: 'supported', evidenceIds: [b.messageEv(firstHuman)] });
  }

  // ---- 파일 변경 ----
  const fileClaim = (key: string, label: string, files: FileFact[]) => {
    if (!files.length) return null;
    return b.claim(key, { statement: `파일 ${files.length}개를 ${label}: ${names(files)}`, kind: 'observed_artifact', support: 'supported', evidenceIds: files.slice(0, 12).flatMap((f) => b.factEv(f, 1)) });
  };
  const createdClaim = fileClaim('files-created', '새로 만들었습니다', built.filesCreated);
  const modifiedClaim = fileClaim('files-modified', '수정했습니다', built.filesModified);
  const deletedClaim = fileClaim('files-deleted', '지웠습니다', built.filesDeleted);
  const fileClaims = [createdClaim, modifiedClaim, deletedClaim].filter((x): x is string => !!x);

  // ---- 테스트 ----
  const tests = commands.filter((x) => x.c.category === 'test');
  const testsAfterChange = tests.filter((x) => (order.get(x.tc.id) ?? -1) > lastChange);
  const lastTest = tests[tests.length - 1];
  const testClaims: string[] = [];
  if (lastTest) {
    const ids = [b.toolEv(lastTest.tc), b.resultEv(lastTest.tc)].filter((x): x is string => !!x);
    testClaims.push(
      b.claim('tests-observed', {
        statement: `테스트 명령을 ${tests.length}회 실행한 기록이 있습니다. 마지막 실행 \`${truncate(lastTest.tc.command ?? '', 80)}\` 의 기록된 결과에는 실패 표시가 ${lastTest.failed ? '있습니다' : '없습니다'}.`,
        kind: 'observed_artifact',
        support: 'supported',
        evidenceIds: ids,
        limits: [SESSION_SCOPE, '실행된 테스트가 다루는 경우만 확인됩니다'],
      }),
    );
  }
  const verificationFindings: string[] = [];
  if (changed.length && !testsAfterChange.length) {
    const c = b.claim('no-test-after-change', { statement: '마지막 파일 변경 뒤에 테스트를 실행한 기록이 없습니다.', kind: 'inference', support: 'supported', evidenceIds: [], limits: [NOT_FOUND_SCOPE] });
    testClaims.push(c);
    verificationFindings.push(
      b.finding({
        ruleId: 'verification-tests-not-observed',
        category: 'verification',
        title: '변경 뒤 확인 기록 없음',
        statement: '이 세션 기록에서는 마지막 파일 변경 뒤에 테스트 실행이 보이지 않습니다. 변경이 기대대로 동작하는지는 이 기록으로 확인되지 않았습니다.',
        evidenceStatus: 'needs_check',
        impact: 'undetermined',
        claimIds: [c, ...fileClaims],
        checks: ['관련 테스트를 실행하고 결과를 확인하세요.', '테스트가 없다면 바뀐 기능을 직접 실행해 주요 흐름을 확인하세요.'],
        relatedConceptIds: ['test-scope', 'testing'],
        missingContext: ['세션 밖에서 실행한 테스트'],
      }),
    );
  }
  if (lastTest?.failed) {
    verificationFindings.push(
      b.finding({
        ruleId: 'verification-tests-failed',
        category: 'verification',
        title: '마지막 테스트 실패',
        statement: '마지막으로 기록된 테스트 실행 결과에 실패 표시가 있습니다. 실패한 상태로 세션이 끝났을 수 있습니다.',
        evidenceStatus: 'observed_in_scope',
        impact: 'medium',
        claimIds: testClaims.slice(0, 1),
        checks: ['테스트를 다시 실행해 지금도 실패하는지 확인하세요.', '실패 메시지가 이번 변경과 관련 있는지 확인하세요.'],
        relatedConceptIds: ['testing', 'error-handling'],
        missingContext: [],
      }),
    );
  }

  // ---- 에이전트 완료 보고 ----
  const lastAssistant = [...session.messages].reverse().find((m) => m.role === 'assistant' && m.text && !m.meta?.subagentId);
  if (lastAssistant && COMPLETE_RE.test(lastAssistant.text ?? '')) {
    const c = b.claim('agent-report', {
      statement: `에이전트가 마지막 답변에서 작업 완료${TEST_CLAIM_RE.test(lastAssistant.text ?? '') ? '와 테스트 통과' : ''}를 보고했습니다.`,
      kind: 'agent_reported',
      support: 'supported',
      evidenceIds: [b.messageEv(lastAssistant)],
      limits: ['에이전트의 보고이며 별도로 확인된 실행 결과가 아닙니다'],
    });
    if (changed.length && !testsAfterChange.length) {
      verificationFindings.push(
        b.finding({
          ruleId: 'verification-agent-claim-unverified',
          category: 'verification',
          title: '완료 보고와 실행 기록 불일치',
          statement: '에이전트가 완료를 보고했지만, 이 기록에는 마지막 변경 뒤의 실행 결과가 없습니다. 보고(agent_reported)와 실제 확인(실행 기록)은 다릅니다.',
          evidenceStatus: 'needs_check',
          impact: 'undetermined',
          claimIds: [c, ...testClaims],
          checks: ['완료라고 한 기능을 직접 실행하거나 테스트를 돌려 결과를 확인하세요.'],
          relatedConceptIds: ['test-scope'],
          missingContext: ['세션 밖에서 실행한 확인'],
        }),
      );
    }
  }
  if (changed.length || tests.length) {
    b.item('change-overview', {
      title: '이번 세션에서 무엇이 바뀌었고, 어디까지 확인되었나요?',
      question: '바뀐 파일과 실제로 확인된 범위는 어디까지인가요?',
      why: [
        built.filesCreated.length ? `새 파일 ${built.filesCreated.length}개` : null,
        built.filesModified.length ? `수정 ${built.filesModified.length}개` : null,
        built.filesDeleted.length ? `삭제 ${built.filesDeleted.length}개` : null,
        `테스트 실행 기록 ${tests.length}회`,
      ]
        .filter(Boolean)
        .join(' · '),
      relevance: 'direct',
      conceptIds: ['change-impact', 'test-scope'],
      claimIds: [...fileClaims, ...testClaims, ...(b.claims.has('c_agent-report') ? ['c_agent-report'] : [])],
      findingIds: verificationFindings,
      actions: verificationFindings.flatMap((f) => b.findings.get(f)?.checks ?? []),
      unverified: ['저장소 전체 코드 (이 기록에 나온 변경만 봄)'],
    });
  }

  // ---- 비밀값 ----
  const secretEvidence: string[] = [];
  let strongSecret = false;
  for (const m of humans) {
    const kind = secretKind(m.text ?? '');
    if (!kind) continue;
    strongSecret ||= kind === 'strong';
    if (secretEvidence.length < 5) secretEvidence.push(b.messageEv(m, true));
  }
  for (const tc of session.toolCalls) {
    const raw = `${tc.command ?? ''}\n${tc.input === undefined ? '' : JSON.stringify(tc.input)}`;
    const kind = secretKind(raw);
    if (!kind) continue;
    strongSecret ||= kind === 'strong';
    if (secretEvidence.length < 5) secretEvidence.push(b.toolEv(tc, raw, true));
  }
  const secretFindings: string[] = [];
  const secretClaims: string[] = [];
  if (secretEvidence.length) {
    const c = b.claim('secret-like-text', { statement: '비밀값(API 키, 토큰, 비밀번호)으로 보이는 문자열이 대화나 도구 입력에 들어 있습니다. 화면에는 가려서 표시합니다.', kind: 'observed_artifact', support: 'supported', evidenceIds: secretEvidence });
    secretClaims.push(c);
    secretFindings.push(
      b.finding({
        ruleId: 'security-secret-in-record',
        category: 'security',
        title: '기록에 남은 비밀값 의심',
        statement: '비밀값으로 보이는 문자열이 대화 기록이나 도구 입력에 들어 있습니다. 실제 키라면 이 기록 파일과, 코드에 들어갔다면 저장소 이력에도 남았을 수 있습니다.',
        evidenceStatus: strongSecret ? 'observed_in_scope' : 'supported_concern',
        impact: 'high',
        claimIds: [c],
        checks: ['실제로 쓰는 키인지 확인하고, 실제 키라면 폐기한 뒤 새로 발급하세요.', '코드나 커밋 이력에 들어갔는지 확인하세요.'],
        relatedConceptIds: ['secrets', 'env-variables'],
        missingContext: ['저장소 이력'],
      }),
    );
  }
  const envFiles = [...built.filesCreated, ...built.filesModified].filter((f) => ENV_FILE_RE.test(path.basename(f.path)));
  if (envFiles.length) {
    const c = b.claim('env-file-changed', { statement: `환경 변수 파일을 만들거나 수정했습니다: ${names(envFiles)}`, kind: 'observed_artifact', support: 'supported', evidenceIds: envFiles.flatMap((f) => b.factEv(f, 1)) });
    secretClaims.push(c);
    secretFindings.push(
      b.finding({
        ruleId: 'security-env-file-tracked',
        category: 'security',
        title: '.env 파일 저장소 포함 여부 미확인',
        statement: '.env 파일이 만들어지거나 수정되었습니다. 이 기록만으로는 .gitignore 에 포함되어 저장소에 올라가지 않는지 확인할 수 없습니다.',
        evidenceStatus: 'needs_check',
        impact: 'medium',
        claimIds: [c],
        checks: ['git status 나 git check-ignore .env 로 .env 가 추적되지 않는지 확인하세요.'],
        relatedConceptIds: ['env-variables', 'gitignore', 'secrets'],
        missingContext: ['.gitignore 내용', '저장소 상태'],
      }),
    );
  }
  if (secretFindings.length) {
    b.item('secrets', {
      title: '비밀값이 기록이나 저장소에 남지 않았나요?',
      question: '이 프로젝트의 비밀값은 어디에 있고, 누가 볼 수 있나요?',
      why: secretFindings.map((f) => b.findings.get(f)?.title).join(' · '),
      relevance: 'direct',
      conceptIds: ['secrets', 'env-variables', 'gitignore'],
      claimIds: secretClaims,
      findingIds: secretFindings,
      actions: secretFindings.flatMap((f) => b.findings.get(f)?.checks ?? []),
      unverified: ['저장소 이력', '배포 환경의 비밀값 설정'],
    });
  }

  // ---- 접근 권한 ----
  const accessFiles = changed.filter((f) => ACCESS_PATH_RE.test(f.relPath ?? f.path));
  const accessHuman = humans.find((m) => ACCESS_TEXT_RE.test(m.text ?? ''));
  if (accessFiles.length || (accessHuman && changed.length)) {
    const ids: string[] = [];
    if (accessFiles.length) ids.push(b.claim('access-files-changed', { statement: `인증·권한과 관련되어 보이는 파일이 바뀌었습니다: ${names(accessFiles)}`, kind: 'observed_artifact', support: 'supported', evidenceIds: accessFiles.flatMap((f) => b.factEv(f, 1)) }));
    if (accessHuman) ids.push(b.claim('access-request', { statement: '사용자 메시지에 관리자나 권한에 관한 요청이 있습니다.', kind: 'observed_artifact', support: 'supported', evidenceIds: [b.messageEv(accessHuman)] }));
    const f = b.finding({
      ruleId: 'security-access-control-unverified',
      category: 'security',
      title: '접근 권한 검사 위치 미확인',
      statement: '인증·권한과 관련된 변경이 있습니다. 이 기록만으로는 접근 권한 검사가 어디에서 수행되는지 확인할 수 없습니다. 라우트 본문에 검사가 보이지 않아도 중앙 미들웨어에 있을 수 있으므로 "없다"고 단정하지 않습니다.',
      evidenceStatus: 'needs_check',
      impact: 'undetermined',
      claimIds: ids,
      checks: ['로그인하지 않은 상태와 다른(일반) 계정으로 같은 기능이나 API를 호출해 거부되는지 확인하세요.', '권한 검사가 중앙 미들웨어에 있는지, 각 라우트에 있는지 확인하세요.'],
      relatedConceptIds: ['authorization', 'auth', 'client-server-boundary'],
      missingContext: ['미들웨어와 라우트 등록 코드', '배포 설정'],
    });
    b.item('access-control', {
      title: '로그인만 하면 누구나 이 기능을 써도 될까요?',
      question: '이 기능을 누가 쓸 수 있는지 어디에서 검사하나요?',
      why: accessFiles.length ? `바뀐 파일: ${names(accessFiles, 4)}` : '사용자 요청에 관리자·권한 관련 내용이 있습니다',
      relevance: 'direct',
      conceptIds: ['authorization', 'auth', 'client-server-boundary'],
      claimIds: ids,
      findingIds: [f],
      actions: b.findings.get(f)?.checks ?? [],
      unverified: ['권한 검사 코드 위치', '배포 환경의 실제 노출 여부'],
    });
  }

  // ---- 네트워크 노출 ----
  const publicServers = built.serversStarted.filter((s) => PUBLIC_BIND_RE.test(s.command));
  if (publicServers.length) {
    const c = b.claim('public-bind', { statement: `개발 서버를 모든 네트워크 주소에 열어 실행한 기록이 있습니다: \`${truncate(publicServers[0]!.command, 80)}\``, kind: 'observed_artifact', support: 'supported', evidenceIds: publicServers.flatMap((s) => b.factEv(s, 1)) });
    const f = b.finding({
      ruleId: 'operation-public-bind',
      category: 'operation',
      title: '외부 접속 가능한 개발 서버',
      statement: '개발 서버를 0.0.0.0(모든 네트워크 주소)으로 열어 실행한 기록이 있습니다. 같은 네트워크의 다른 사람이 접속할 수 있었을 수 있습니다. 실제 배포 환경의 노출 여부는 확인되지 않았습니다.',
      evidenceStatus: 'supported_concern',
      impact: 'medium',
      claimIds: [c],
      checks: ['외부 접속이 필요 없다면 127.0.0.1(localhost)로만 열어 실행하세요.', '열어 둔 동안 로그인 없이 볼 수 있는 데이터가 있었는지 확인하세요.'],
      relatedConceptIds: ['ports-localhost', 'client-server-boundary'],
      missingContext: ['네트워크·방화벽 설정'],
    });
    b.item('network-exposure', {
      title: '개발 서버가 다른 사람에게도 열려 있었나요?',
      question: '이 서버에 누가 접속할 수 있었나요?',
      why: '서버 실행 명령에 0.0.0.0 또는 --host 가 있습니다',
      relevance: 'direct',
      conceptIds: ['ports-localhost', 'client-server-boundary'],
      claimIds: [c],
      findingIds: [f],
      actions: b.findings.get(f)?.checks ?? [],
      unverified: ['네트워크·방화벽 설정'],
    });
  }

  // ---- 되돌리기 ----
  const destructive: { tc: ToolCall; label: string }[] = [];
  for (const x of commands) {
    const cmd = x.tc.command ?? '';
    const argv = x.c.argv;
    if (argv[0] === 'rm') {
      const flags = argv.filter((a) => a.startsWith('-')).join('');
      const targets = argv.slice(1).filter((a) => !a.startsWith('-'));
      if (/r/i.test(flags) && /f/.test(flags) && targets.some((t) => !BENIGN_RM_RE.test(t))) destructive.push({ tc: x.tc, label: 'rm -rf' });
      continue;
    }
    const hit = DESTRUCTIVE_RES.find((d) => d.re.test(cmd));
    if (hit && !destructive.some((d) => d.tc.id === x.tc.id)) destructive.push({ tc: x.tc, label: hit.label });
  }
  const rollbackFindings: string[] = [];
  const rollbackClaims: string[] = [];
  if (destructive.length) {
    const c = b.claim('destructive-commands', { statement: `되돌리기 어려운 명령을 실행한 기록이 있습니다: ${[...new Set(destructive.map((d) => d.label))].join(', ')}`, kind: 'observed_artifact', support: 'supported', evidenceIds: destructive.slice(0, 5).map((d) => b.toolEv(d.tc)) });
    rollbackClaims.push(c);
    rollbackFindings.push(
      b.finding({
        ruleId: 'change-destructive-command',
        category: 'change',
        title: '되돌리기 어려운 명령 실행',
        statement: '파일 삭제, 강제 push, 데이터 삭제처럼 되돌리기 어려운 명령이 실행되었습니다. 의도한 대상에만 적용되었는지는 이 기록으로 확인되지 않았습니다.',
        evidenceStatus: 'supported_concern',
        impact: 'high',
        claimIds: [c],
        checks: ['지워지거나 덮어써진 것이 의도한 대상뿐인지 확인하세요.', '필요하면 백업이나 이전 커밋에서 복구하세요.'],
        relatedConceptIds: ['rollback', 'git-basics'],
        missingContext: ['명령 실행 전 상태'],
      }),
    );
  }
  if (changed.length && !built.gitCommits.length) {
    const c = b.claim('no-commit', { statement: '변경 뒤에 git commit 을 실행한 기록이 없습니다.', kind: 'inference', support: 'supported', evidenceIds: [], limits: [NOT_FOUND_SCOPE] });
    rollbackClaims.push(c);
    rollbackFindings.push(
      b.finding({
        ruleId: 'change-no-checkpoint',
        category: 'change',
        title: '되돌아갈 지점 미확인',
        statement: '이 세션 기록에서는 변경 뒤 git commit 이 보이지 않습니다. 문제가 생겼을 때 되돌아갈 지점이 있는지 확인하세요.',
        evidenceStatus: 'needs_check',
        impact: 'low',
        claimIds: [c, ...fileClaims],
        checks: ['git status 로 커밋되지 않은 변경을 확인하고, 동작하는 상태라면 커밋해 두세요.'],
        relatedConceptIds: ['rollback', 'git-basics'],
        missingContext: ['세션 밖의 커밋'],
      }),
    );
  }
  if (rollbackFindings.length) {
    b.item('rollback', {
      title: '문제가 생기면 어디로 되돌아갈 수 있나요?',
      question: '지금 상태로 되돌아갈 지점과, 되돌릴 수 없는 변경은 무엇인가요?',
      why: rollbackFindings.map((f) => b.findings.get(f)?.title).join(' · '),
      relevance: 'direct',
      conceptIds: ['rollback', 'git-basics'],
      claimIds: rollbackClaims,
      findingIds: rollbackFindings,
      actions: rollbackFindings.flatMap((f) => b.findings.get(f)?.checks ?? []),
      unverified: ['세션 밖의 커밋과 백업'],
    });
  }

  // ---- 해결되지 않은 실패 ----
  const unresolved = commands.filter((x, i) => x.failed && !['inspect', 'other', 'test', 'file'].includes(x.c.category) && !commands.slice(i + 1).some((y) => y.c.key === x.c.key && !y.failed));
  if (unresolved.length) {
    const seen = new Set<string>();
    const uniq = unresolved.filter((x) => (seen.has(x.c.key) ? false : (seen.add(x.c.key), true)));
    const ids = uniq.slice(0, 5).flatMap((x) => [b.toolEv(x.tc), b.resultEv(x.tc)].filter((v): v is string => !!v));
    const c = b.claim('failed-commands', { statement: `실패로 기록된 뒤 같은 명령이 성공한 기록이 없는 명령 ${uniq.length}개가 있습니다.`, kind: 'observed_artifact', support: 'supported', evidenceIds: ids });
    const f = b.finding({
      ruleId: 'operation-unresolved-failures',
      category: 'operation',
      title: '해결 기록이 없는 실패',
      statement: '실패로 기록된 명령 가운데 이후 같은 명령이 성공한 기록이 없는 것이 있습니다. 다른 방법으로 해결했을 수도 있지만 이 기록으로는 확인되지 않았습니다.',
      evidenceStatus: 'observed_in_scope',
      impact: 'low',
      claimIds: [c],
      checks: ['실패한 명령을 다시 실행해 지금도 실패하는지 확인하세요.'],
      relatedConceptIds: ['error-handling'],
      missingContext: [],
    });
    b.item('failures', {
      title: '실패한 명령은 해결되었나요?',
      question: '어떤 명령이 실패했고, 지금도 실패하나요?',
      why: uniq.slice(0, 3).map((x) => `\`${truncate(x.tc.command ?? '', 40)}\``).join(', '),
      relevance: 'direct',
      conceptIds: ['error-handling'],
      claimIds: [c],
      findingIds: [f],
      actions: b.findings.get(f)?.checks ?? [],
      unverified: [],
    });
  }

  // ---- 데이터 유지 ----
  const persistHuman = humans.filter((m) => PERSIST_TEXT_RE.test(m.text ?? '')).slice(0, 3);
  if (persistHuman.length) {
    const c = b.claim('persistence-report', { statement: '사용자 메시지에 데이터가 사라지거나 저장되지 않는다는 내용이 있습니다.', kind: 'observed_artifact', support: 'supported', evidenceIds: persistHuman.map((m) => b.messageEv(m)) });
    const f = b.finding({
      ruleId: 'data-persistence-unclear',
      category: 'data',
      title: '데이터 저장 위치 미확인',
      statement: '데이터가 사라지거나 저장되지 않는다는 대화가 있습니다. 이 기록만으로는 데이터가 어디에 저장되는지(화면 상태, 브라우저, 서버, DB) 확인할 수 없습니다. DB에 저장하지 않았다고 단정하지 않습니다.',
      evidenceStatus: 'needs_check',
      impact: 'undetermined',
      claimIds: [c],
      checks: ['새로고침, 서버 재시작, 다른 브라우저에서 데이터가 남는지 확인하세요.', '저장하는 코드가 어디에 있는지(브라우저/서버/DB) 확인하세요.'],
      relatedConceptIds: ['client-state', 'persistence'],
      missingContext: ['저장 코드', '서버 로그'],
    });
    b.item('persistence', {
      title: '데이터는 어디에 저장되고, 새로고침하면 남나요?',
      question: '이 데이터의 저장 위치와 수명은 무엇인가요?',
      why: '사용자 메시지에 데이터가 사라진다는 내용이 있습니다',
      relevance: 'direct',
      conceptIds: ['client-state', 'persistence', 'atomic-change'],
      claimIds: [c],
      findingIds: [f],
      actions: b.findings.get(f)?.checks ?? [],
      unverified: ['저장 코드 위치', '서버 로그'],
    });
  }

  // ---- 유료 AI API ----
  const llmPackages = built.packagesInstalled.filter((p) => LLM_PACKAGE_RE.test(p.name));
  const llmHit = concepts.find((h) => h.id === 'llm-api');
  if (llmPackages.length || llmHit) {
    const ids = llmPackages.length ? llmPackages.flatMap((p) => b.factEv(p, 1)) : b.factEv(llmHit!, 3);
    if (ids.length) {
      const c = b.claim('llm-usage', { statement: llmPackages.length ? `AI API 라이브러리를 설치했습니다: ${llmPackages.map((p) => p.name).join(', ')}` : '이 세션에 AI(LLM) API 사용 흔적이 있습니다.', kind: 'observed_artifact', support: 'supported', evidenceIds: ids });
      const f = b.finding({
        ruleId: 'operation-llm-cost-limit',
        category: 'operation',
        title: 'AI API 비용 상한 미확인',
        statement: '유료일 수 있는 AI API를 쓰는 코드가 추가된 것으로 보입니다. 호출 횟수나 비용 상한이 있는지는 이 기록으로 확인할 수 없습니다.',
        evidenceStatus: 'needs_check',
        impact: 'undetermined',
        claimIds: [c],
        checks: ['제공자 대시보드에 월 예산 상한을 설정했는지 확인하세요.', '사용자 입력마다 호출하는 코드라면 호출 수 제한이 있는지 확인하세요.'],
        relatedConceptIds: ['rate-limit', 'llm-api', 'secrets'],
        missingContext: ['제공자 계정 설정'],
      });
      b.item('llm-cost', {
        title: 'AI API 호출에 비용 상한이 있나요?',
        question: '이 기능이 한 달에 최대 얼마를 쓸 수 있나요?',
        why: llmPackages.length ? `설치한 라이브러리: ${llmPackages.map((p) => p.name).join(', ')}` : 'AI API 관련 흔적이 있습니다',
        relevance: 'direct',
        conceptIds: ['rate-limit', 'llm-api', 'secrets'],
        claimIds: [c],
        findingIds: [f],
        actions: b.findings.get(f)?.checks ?? [],
        unverified: ['제공자 계정의 예산 설정'],
      });
    }
  }

  // ---- 의존성 ----
  if (built.packagesInstalled.length) {
    const pkgs = built.packagesInstalled;
    const c = b.claim('packages', { statement: `외부 라이브러리 ${pkgs.length}개를 설치했습니다: ${pkgs.slice(0, 8).map((p) => p.name).join(', ')}${pkgs.length > 8 ? ' 외' : ''}`, kind: 'observed_artifact', support: 'supported', evidenceIds: pkgs.slice(0, 8).flatMap((p) => b.factEv(p, 1)) });
    const python = pkgs.some((p) => ['pip', 'uv', 'poetry'].includes(p.manager));
    b.item('dependencies', {
      title: '새로 추가한 라이브러리는 무엇이고, 무엇에 영향을 주나요?',
      question: '이 라이브러리들이 없으면 무엇이 동작하지 않나요?',
      why: `설치 기록 ${pkgs.length}개`,
      relevance: 'direct',
      conceptIds: [python ? 'python-venv' : 'npm-package-json', 'change-impact'],
      claimIds: [c],
      findingIds: [],
      actions: ['설치한 라이브러리가 실제로 쓰이는지, 버전이 고정되어 있는지 확인하세요.'],
      unverified: ['라이브러리의 유지보수 상태'],
    });
  }

  // ---- 서버 입력 경계 ----
  const apiFiles = [...built.filesCreated, ...built.filesModified].filter((f) => API_PATH_RE.test(f.relPath ?? f.path));
  if (apiFiles.length) {
    const c = b.claim('api-files', { statement: `서버나 API로 보이는 파일이 바뀌었습니다: ${names(apiFiles)}`, kind: 'observed_artifact', support: 'supported', evidenceIds: apiFiles.slice(0, 8).flatMap((f) => b.factEv(f, 1)) });
    b.item('api-boundary', {
      title: '서버가 받는 입력은 어디에서 검사되나요?',
      question: '잘못된 입력이나 실패가 들어오면 이 API는 어떻게 응답하나요?',
      why: `바뀐 파일: ${names(apiFiles, 4)}`,
      relevance: 'direct',
      conceptIds: ['input-validation', 'client-server-boundary', 'error-handling'],
      claimIds: [c],
      findingIds: [],
      actions: ['빈 값이나 형식이 틀린 값을 보내 400 같은 거부 응답이 오는지 확인하세요.'],
      unverified: ['입력 검증 코드 위치'],
    });
  }

  // ---- 배경 개념 (자동 감지된 개념 중 아직 연결되지 않은 것) ----
  const covered = new Set([...b.items.values()].flatMap((i) => i.conceptIds));
  let bg = 0;
  for (const hit of [...concepts].sort((x, y) => y.score - x.score || x.id.localeCompare(y.id))) {
    if (bg >= 3 || covered.has(hit.id) || !input.conceptIds.has(hit.id)) continue;
    const ids = b.factEv(hit, 3);
    if (!ids.length) continue;
    const c = b.claim(`concept-${hit.id}`, { statement: `이 세션 기록에 ${hit.name} 관련 흔적이 있습니다.`, kind: 'observed_artifact', support: 'supported', evidenceIds: ids });
    b.item(`bg-${hit.id}`, { title: `${hit.name}`, question: `이 세션에서 쓰인 ${hit.name}, 무엇인가요?`, why: hit.whyHere, relevance: 'background', conceptIds: [hit.id], claimIds: [c], findingIds: [], actions: [], unverified: [] });
    bg += 1;
  }

  // ---- 수집 범위 ----
  const shellCalls = session.toolCalls.filter((tc) => tc.category === 'shell');
  const coverage: WikiCoverage = {
    chat: session.parseWarnings.some((w) => /partial trailing line/.test(w)) ? 'partial' : 'complete_for_export',
    diff: !changed.length ? 'unavailable' : changed.some((f) => f.via === 'shell') ? 'partial' : 'available',
    repository: 'unavailable',
    runtimeLogs: !shellCalls.length ? 'unavailable' : shellCalls.every((tc) => tc.result) ? 'available' : 'partial',
    deploymentConfig: 'unavailable',
    notes: [
      '저장소 전체 코드는 읽지 않았습니다. "보이지 않음"은 이 세션 기록 안에서 찾지 못했다는 뜻입니다.',
      '명령은 다시 실행하지 않았습니다. 실행 결과는 기록에 남은 출력만 봅니다.',
      ...(changed.some((f) => f.via === 'shell') ? ['셸 명령으로 바꾼 파일은 내용 변경을 자세히 알 수 없습니다.'] : []),
    ],
  };

  return {
    schemaVersion: WIKI_SCHEMA_VERSION,
    projectId: session.projectId,
    sessionKey: session.key,
    revision,
    builtAt: (input.now ?? new Date()).toISOString(),
    generator: { kind: 'rule-based', rulesVersion: RULES_VERSION, catalogVersion: input.catalogVersion },
    status: !session.messages.length ? 'failed' : session.parseWarnings.some((w) => /not valid JSON|partial trailing line/.test(w)) ? 'partial' : 'success',
    coverage,
    evidence: [...b.evidence.values()],
    claims: [...b.claims.values()],
    findings: [...b.findings.values()],
    items: [...b.items.values()],
    warnings: b.warnings,
  };
}
