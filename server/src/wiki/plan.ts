import type {
  ExplanationDepth,
  KnowledgeItem,
  LearnerConceptState,
  LearnerProfile,
  RenderBundle,
  RenderPlan,
  RiskFinding,
  WikiConcept,
  WikiSnapshot,
} from '@vibe-teacher/shared';
import type { QuestionBank } from '../assessment/bank';
import type { WikiSettings } from '../config/schema';
import { POLICY_VERSION, conceptState } from '../learner/reducer';
import { prerequisiteBundle, type PrerequisiteGraph } from './graph';

/**
 * 설명 계획기 (plan §9). 출력은 텍스트가 아니라 RenderPlan 이다.
 * 1) 사용자 상태를 보기 전에 공통 알림을 정한다 — 숙련 추정이 경고를 숨기지 못한다.
 * 2) 항목별 설명 깊이·선행 bundle 을 정하고, 우선순위대로 예산(B_brief)에 맞춘다.
 * 깊이 규칙과 숫자는 개발용 초기값이며 검증된 정책이 아니다.
 */

const IMPACT_RANK: Record<RiskFinding['impact'], number> = { high: 0, medium: 1, undetermined: 2, low: 3 };
const DEPTHS: ExplanationDepth[] = ['D0', 'D1', 'D2', 'D3'];

/** 로컬 근사 토큰 수 (한글 음절 ≈ 0.8, 그 외 4글자 ≈ 1). 실제 tokenizer 가 아니므로 'approximate' 로 기록한다. */
export function approximateTokens(text: string): number {
  let hangul = 0;
  let other = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0xac00 && code <= 0xd7a3) hangul += 1;
    else other += 1;
  }
  return Math.ceil(hangul * 0.8 + other / 4);
}

/** 공통 알림: 프로젝트 데이터만 본다. 영향 high/medium, 또는 보안·데이터·자원 경계의 영향 미정 항목. */
export function selectCommonAlerts(findings: RiskFinding[]): RiskFinding[] {
  return findings
    .filter((f) => f.lifecycle === 'open' || f.lifecycle === 'recheck_required')
    .filter((f) => f.impact === 'high' || f.impact === 'medium' || (f.impact === 'undetermined' && (f.category === 'security' || f.category === 'data' || f.category === 'operation')))
    .sort((a, b) => IMPACT_RANK[a.impact] - IMPACT_RANK[b.impact] || a.id.localeCompare(b.id));
}

export function alertText(f: RiskFinding): string {
  return [f.title, f.statement, ...f.checks].join('\n');
}

export function conceptText(c: WikiConcept | undefined, depth: ExplanationDepth): string {
  if (!c) return '';
  if (depth === 'D0') return c.summary;
  const parts = [c.explanation];
  if (depth === 'D2' || depth === 'D3') parts.push(c.example ?? '', ...c.confusions);
  if (depth === 'D3') parts.push(c.deep ?? '');
  return parts.filter(Boolean).join('\n');
}

/** plan §9.3 초기 규칙. 같은 사용자라도 항목마다 다르게 적용된다. */
export function chooseDepth(states: LearnerConceptState[]): { depth: ExplanationDepth; reasons: string[] } {
  const primary = states[0];
  if (!primary) return { depth: 'D1', reasons: ['no_concept'] };
  const weak = states.filter((s) => s.state === 'partial' || s.state === 'conflicting' || s.counts.incorrect > 0);
  if (weak.length) return { depth: 'D2', reasons: weak.map((s) => `${s.state === 'unknown' ? 'incorrect_response' : s.state}:${s.conceptId}`) };
  if (primary.selfReport === 'unfamiliar') return { depth: 'D1', reasons: ['self_report_unfamiliar'] };
  if (primary.selfReport === 'known') return { depth: 'D0', reasons: ['self_report_known_preference'] };
  if (states.every((s) => s.state === 'demonstrated')) return { depth: 'D1', reasons: ['demonstrated_awareness_unconfirmed'] };
  return { depth: 'D1', reasons: ['evidence_unknown'] };
}

export interface PlanInput {
  snapshot: WikiSnapshot;
  profile: LearnerProfile | null;
  concepts: Map<string, WikiConcept>;
  graph: PrerequisiteGraph;
  settings: WikiSettings;
  bank?: QuestionBank;
  /** 이 학습자가 이미 응답한 문항 (다시 제안하지 않음) */
  answeredQuestionIds?: ReadonlySet<string>;
}

export function planWiki(input: PlanInput): RenderPlan {
  const { snapshot, profile, concepts, graph, settings } = input;
  const budget = settings.briefTokenBudget;
  const findings = new Map(snapshot.findings.map((f) => [f.id, f]));

  // 1) 공통 알림 — profile 을 보지 않는다
  const alerts = selectCommonAlerts(snapshot.findings);
  const alertIds = new Set(alerts.map((f) => f.id));
  let used = alerts.reduce((n, f) => n + approximateTokens(alertText(f)), 0);
  let status: RenderPlan['budget']['status'] = used > budget ? 'mandatory_overflow' : 'within';

  // 2) 항목별 깊이와 bundle
  const stateOf = (id: string) => conceptState(profile, id);
  const isKnown = (id: string) => {
    const s = stateOf(id);
    return s.state === 'demonstrated' || s.selfReport === 'known';
  };
  const explained = new Set<string>();
  const makeBundle = (item: KnowledgeItem, depth: ExplanationDepth, reasons: string[]): RenderBundle => {
    const primary = item.conceptIds[0];
    const pre = primary
      ? prerequisiteBundle([primary], depth, graph, isKnown, { maxDepth: settings.maxPrerequisiteDepth, maxCount: settings.maxPrerequisitesPerBundle })
      : { prerequisites: [], unmet: [] };
    const prereqTokens = pre.prerequisites.filter((p) => !explained.has(p.conceptId)).reduce((n, p) => n + approximateTokens(concepts.get(p.conceptId)?.summary ?? ''), 0);
    const primaryTokens = primary && !explained.has(primary) ? approximateTokens(conceptText(concepts.get(primary), depth)) : 0;
    return {
      itemId: item.id,
      depth,
      prerequisites: pre.prerequisites.map((p) => ({ conceptId: p.conceptId, recallOnly: p.recallOnly || explained.has(p.conceptId) })),
      prerequisiteUnmet: pre.unmet,
      reasonCodes: [...reasons, ...(pre.unmet.length ? ['prerequisite_unmet'] : [])],
      tokens: approximateTokens(`${item.title}\n${item.why}`) + primaryTokens + prereqTokens,
    };
  };

  const candidates = snapshot.items.map((item) => {
    const { depth, reasons } = chooseDepth(item.conceptIds.map(stateOf));
    const primary = item.conceptIds[0];
    const needsExplanation = primary ? !isKnown(primary) : false;
    const alertLinked = item.findingIds.some((id) => alertIds.has(id));
    return { item, depth, reasons, needsExplanation, alertLinked, estimate: makeBundle(item, depth, reasons).tokens };
  });
  // 필요 시점(알림 연결) → 현재 판단 관련성(direct) → 설명 필요 → 읽기 비용 → ID
  // AI 가 제안한 항목은 규칙 기반 항목 뒤에 둔다 (검증 전 후보가 확인된 내용을 밀어내지 않게)
  candidates.sort(
    (a, b) =>
      Number(b.alertLinked) - Number(a.alertLinked) ||
      Number(a.item.origin === 'llm') - Number(b.item.origin === 'llm') ||
      Number(b.item.relevance === 'direct') - Number(a.item.relevance === 'direct') ||
      Number(b.needsExplanation) - Number(a.needsExplanation) ||
      a.estimate - b.estimate ||
      a.item.id.localeCompare(b.item.id),
  );

  const bundles: RenderBundle[] = [];
  const deferred: RenderPlan['deferred'] = [];
  for (const c of candidates) {
    if (status === 'mandatory_overflow') {
      deferred.push({ itemId: c.item.id, reason: 'mandatory_overflow' });
      continue;
    }
    let chosen: RenderBundle | null = null;
    for (let d = DEPTHS.indexOf(c.depth); d >= 0; d -= 1) {
      const depth = DEPTHS[d]!;
      const trimmed = depth !== c.depth;
      const bundle = makeBundle(c.item, depth, trimmed ? [...c.reasons, 'trimmed_for_budget'] : c.reasons);
      if (used + bundle.tokens <= budget) {
        chosen = bundle;
        if (trimmed) status = 'trimmed';
        break;
      }
    }
    if (!chosen) {
      deferred.push({ itemId: c.item.id, reason: 'budget' });
      if (status === 'within') status = 'trimmed';
      continue;
    }
    bundles.push(chosen);
    used += chosen.tokens;
    const primary = c.item.conceptIds[0];
    if (primary) explained.add(primary);
    for (const p of chosen.prerequisites) explained.add(p.conceptId);
  }

  // 3) 선택 질문 제안: 현재 판단과 연결 + 이해 증거 부족/충돌 + 응답에 따라 설명이 달라질 수 있음
  const optionalQuestionIds: string[] = [];
  if (settings.suggestQuestions && input.bank) {
    const answered = input.answeredQuestionIds ?? new Set<string>();
    for (const bundle of bundles) {
      if (optionalQuestionIds.length >= settings.maxOptionalQuestions) break;
      const item = snapshot.items.find((i) => i.id === bundle.itemId);
      const primary = item?.conceptIds[0];
      if (!item || item.relevance !== 'direct' || !primary) continue;
      const s = stateOf(primary);
      if (s.state === 'demonstrated' || s.selfReport === 'known') continue;
      const q = [...input.bank.questions.values()]
        .filter((x) => x.target === 'concept_knowledge' && x.conceptIds[0] === primary && !answered.has(x.questionId) && !optionalQuestionIds.includes(x.questionId))
        .sort((a, b) => Number(b.format === 'true_false') - Number(a.format === 'true_false') || a.questionId.localeCompare(b.questionId))[0];
      if (q) optionalQuestionIds.push(q.questionId);
    }
  }

  const missing = new Set<string>();
  for (const f of alerts) for (const m of f.missingContext) missing.add(m);
  for (const b of bundles) for (const id of snapshot.items.find((i) => i.id === b.itemId)?.findingIds ?? []) for (const m of findings.get(id)?.missingContext ?? []) missing.add(m);
  if (snapshot.coverage.repository === 'unavailable') missing.add('저장소 전체 코드');
  if (snapshot.coverage.deploymentConfig === 'unavailable') missing.add('배포 설정');

  return {
    projectRevision: snapshot.revision,
    profileRevision: profile?.revision ?? 0,
    policyVersion: POLICY_VERSION,
    commonAlertIds: alerts.map((f) => f.id),
    bundles,
    optionalQuestionIds,
    deferred,
    budget: { limit: budget, used, tokenizer: 'approximate', status },
    missingContext: [...missing],
    personalized: profile !== null,
  };
}
