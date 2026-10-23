import type { ExplanationDepth, LearnerProfile, RenderPlan, RiskFinding, WikiConcept, WikiSnapshot } from '@vibe-teacher/shared';
import type { QuestionBank } from '../assessment/bank';
import type { WikiSettings } from '../config/schema';
import { prerequisiteBundle, type PrerequisiteGraph } from './graph';

/** 예산 계산만 수행한다. 항목의 선정·순서·설명 깊이·선행관계는 AI 결과를 따른다. */
export function approximateTokens(text: string): number {
  let n = 0;
  for (const c of text) n += /[가-힣]/.test(c) ? 0.8 : 0.25;
  return Math.ceil(n);
}
export function selectCommonAlerts(findings: RiskFinding[]): RiskFinding[] {
  return findings.filter((f) => f.lifecycle === 'open' || f.lifecycle === 'recheck_required');
}
export const alertText = (f: RiskFinding) => [f.title, f.statement, ...f.checks].join('\n');
export function conceptText(c: WikiConcept | undefined, depth: ExplanationDepth): string {
  if (!c) return '';
  if (depth === 'D0') return c.summary;
  return [c.explanation, ...(depth === 'D2' || depth === 'D3' ? [c.example ?? '', ...c.confusions] : []), ...(depth === 'D3' ? [c.deep ?? ''] : [])].filter(Boolean).join('\n');
}
export interface PlanInput {
  snapshot: WikiSnapshot; profile: LearnerProfile | null; concepts: Map<string, WikiConcept>; graph: PrerequisiteGraph; settings: WikiSettings;
  bank?: QuestionBank; answeredQuestionIds?: ReadonlySet<string>;
}
export function planWiki({ snapshot, profile, concepts, graph, settings }: PlanInput): RenderPlan {
  const alerts = selectCommonAlerts(snapshot.findings);
  let used = alerts.reduce((n, f) => n + approximateTokens(alertText(f)), 0);
  const bundles: RenderPlan['bundles'] = [], deferred: RenderPlan['deferred'] = [];
  for (const item of snapshot.items) {
    const depth = item.suggestedDepth ?? 'D1';
    const pre = prerequisiteBundle(item.conceptIds.slice(0, 1), depth, graph, () => false, { maxDepth: settings.maxPrerequisiteDepth, maxCount: settings.maxPrerequisitesPerBundle });
    const tokens = approximateTokens([item.title, item.why, ...item.conceptIds.map((id) => conceptText(concepts.get(id), depth))].join('\n'));
    if (used + tokens > settings.briefTokenBudget) { deferred.push({ itemId: item.id, reason: 'budget' }); continue; }
    used += tokens;
    bundles.push({ itemId: item.id, depth, prerequisites: pre.prerequisites.map((p) => ({ conceptId: p.conceptId, recallOnly: false })), prerequisiteUnmet: pre.unmet, reasonCodes: ['ai_selected'], tokens });
  }
  return {
    projectRevision: snapshot.revision, profileRevision: profile?.revision ?? 0, policyVersion: 'ai-reading-plan-1', commonAlertIds: alerts.map((f) => f.id),
    bundles, optionalQuestionIds: [], deferred,
    budget: { limit: settings.briefTokenBudget, used, tokenizer: 'approximate', status: used > settings.briefTokenBudget ? 'mandatory_overflow' : deferred.length ? 'trimmed' : 'within' },
    missingContext: [...new Set(alerts.flatMap((f) => f.missingContext))], personalized: false,
  };
}
