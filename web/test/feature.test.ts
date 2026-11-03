import { createElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { REPO_FEATURE_LIMITS, type RepoFeature, type RepoFeaturePage, type RepoFeatureResponse } from '@vibe-teacher/shared';
import { CodeBlock, codeLanguage, highlightLines, tokenize } from '../src/components/CodeBlock';
import { RepoFeatureView, featureMeta } from '../src/components/RepoFeatureView';
import { Block, FeatureCards, FeatureContext } from '../src/components/RepoWikiView';

const render = (el: ReactElement) => renderToStaticMarkup(createElement(MemoryRouter, null, el));
const file = (path: string, startLine?: number, endLine?: number) => ({ kind: 'file' as const, path, ...(startLine ? { startLine, endLine } : {}) });
const feature: RepoFeature = { id: 'summary', name: '글 요약', summary: '글을 받아 요약합니다.', files: [file('server/summarize.ts')], sessions: [{ kind: 'session', key: 's1', title: '요약 기능 만들기' }], sources: [] };
const prompt = 'export const SYSTEM = `당신은 요약가입니다.`;';
const page: RepoFeaturePage = {
  version: 1, featureId: 'summary', level: 'junior', revision: 'r1', at: '2026-11-03T01:00:00.000Z', name: '글 요약', summary: '글을 받아 요약합니다.',
  generator: { provider: 'claude-cli', model: 'fixture-model', durationMs: 10, calls: 4, rounds: 2, costUsd: 0.0123 },
  overview: ['글을 보내면 요약을 돌려줍니다.'], overviewSources: [file('server/summarize.ts', 1, 3)],
  userFlow: [{ title: '요약 버튼을 누릅니다', detail: '서버가 요약 함수를 부릅니다.', sources: [file('server/main.ts', 2, 3)] }],
  files: [{ path: 'server/main.ts', role: '요청을 받습니다.', sources: [file('server/main.ts', 1, 4)] }],
  aiCalls: [
    { purpose: '글 요약', provider: 'OpenAI SDK', model: 'gpt-4o-mini', modelOrigin: 'code', modelSource: file('server/summarize.ts', 9, 9), systemPrompt: { source: file('server/summarize.ts', 2, 2), text: prompt, prompts: [{ line: 11, call: 'client.chat · gpt-4o-mini', via: ['withGuide'], from: [{ path: 'server/prompts.ts', line: 3 }], segments: [{ kind: 'text', text: '당신은 요약가입니다. 언어: ' }, { kind: 'slot', text: 'lang' }] }] }, userPrompt: { source: file('server/summarize.ts', 5, 5), text: 'const user = JSON.stringify(input);' }, outputHandling: '첫 응답을 돌려줍니다.', sources: [file('server/summarize.ts', 8, 11)] },
  ],
  questions: [{ round: 1, question: '어떤 모델인가요?', answer: 'gpt-4o-mini 입니다.', sources: [file('server/summarize.ts', 9, 9)] }, { round: 2, question: '어디서 부르나요?', answer: 'main 에서 부릅니다.', sources: [file('server/main.ts', 2, 3)] }],
  limits: ['오류 처리는 확인하지 못했습니다.'], warnings: ['출처를 확인할 수 없는 AI 설명 1개를 제외했습니다.'], read: [],
};
const response = (p: RepoFeaturePage | null): RepoFeatureResponse => ({ feature, page: p, stale: false, staleReasons: [], limits: REPO_FEATURE_LIMITS });

describe('코드 색칠', () => {
  it('언어별로 문자열·주석·키워드·숫자·함수를 나누고 템플릿의 ${식} 을 따로 표시한다', () => {
    const kinds = (code: string, lang: Parameters<typeof tokenize>[1]) => tokenize(code, lang).filter((t) => t.kind !== 'plain').map((t) => [t.kind, t.text]);
    expect(kinds('const a = `hi ${name}`; // 끝', 'js')).toEqual([['keyword', 'const'], ['string', '`hi '], ['slot', '${name}'], ['string', '`'], ['comment', '// 끝']]);
    expect(kinds('def run(x): return f"{x}" # c\nprint(None, 3)', 'py')).toEqual([['keyword', 'def'], ['function', 'run'], ['keyword', 'return'], ['string', 'f"{x}"'], ['comment', '# c'], ['function', 'print'], ['number', 'None'], ['number', '3']]);
    expect(kinds('{"model": "gpt", "n": 1}', 'json')).toEqual([['property', '"model"'], ['string', '"gpt"'], ['property', '"n"'], ['number', '1']]);
    expect(kinds('echo $HOME # 주석', 'sh')).toEqual([['slot', '$HOME'], ['comment', '# 주석']]);
    expect(codeLanguage('src/App.tsx')).toBe('js');
    expect(codeLanguage('README')).toBe('text');
  });

  it('여러 줄 주석·문자열도 줄마다 같은 색을 유지하고 HTML 을 해석하지 않는다', () => {
    const lines = highlightLines('/* 첫 줄\n둘째 줄 */\nconst x = 1;', 'js');
    expect(lines[1]).toEqual([{ kind: 'comment', text: '둘째 줄 */' }]);
    const html = renderToStaticMarkup(createElement(CodeBlock, { code: 'const s = "<script>alert(1)</script>";', path: 'a.ts' }));
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
  });
});

describe('주요 기능 페이지 화면', () => {
  it('사용자 흐름·관련 파일·AI 호출의 모델과 저장소 원문 프롬프트·단계별 질문을 보여 준다', () => {
    const html = render(createElement(RepoFeatureView, { data: response(page) }));
    for (const text of ['한눈에 보기', '사용자는 이렇게 씁니다', '요약 버튼을 누릅니다', '관련 파일', 'AI 호출', '<code>gpt-4o-mini</code>', '코드에 적힌 값', '시스템 프롬프트', '사용자 프롬프트', '1단계 확인', '2단계 확인', '어떤 모델인가요?', '확인하지 못한 것']) expect(html).toContain(text);
    // 실제로 가는 문장만 펼쳐 보이고, 실행 중 채워지는 값은 따로 표시하며, 전체 코드는 접어 둔다
    expect(html).toContain('<pre class="prompt-text">당신은 요약가입니다. 언어: <span class="prompt-slot" title="실행할 때 채워지는 값">{lang}</span></pre>');
    expect(html).toContain('11줄 · client.chat · gpt-4o-mini');
    expect(html).toContain('withGuide를 거쳐 전달됩니다');
    expect(html).toContain('server/prompts.ts:3');
    expect(html).toMatch(/<details class="feature-code"><summary>코드 보기<\/summary><pre class="repo-code code-block"><code><span class="code-line-number" aria-hidden="true">2<\/span><span class="syntax-keyword">export<\/span>/);
    // 고정 문장이 없는 사용자 프롬프트는 지어내지 않고 코드를 펼쳐 둔다
    expect(html).toContain('프롬프트를 특정하지 못했습니다');
    expect(html).toContain('<details class="feature-code" open="">');
    expect(html).toContain('server/summarize.ts:9');
    expect(featureMeta(response(page))).toContain('AI 호출 4번 · 추가 확인 2단계');
    expect(featureMeta(response(page))).toContain('$0.0123');
  });

  it('분석 전에는 레포 위키가 고른 파일과 세션만 보여 준다', () => {
    const html = render(createElement(RepoFeatureView, { data: response(null) }));
    expect(html).toContain('레포 위키가 고른 관련 파일');
    expect(html).toContain('server/summarize.ts');
    expect(html).toContain('href="/sessions/s1?tab=understand"');
    expect(html).not.toContain('AI 호출');
    expect(featureMeta(response(null))).toBeNull();
  });

  it('기능 카드는 기능별 페이지로 잇고 자세한 분석 여부를 표시한다', () => {
    const html = render(createElement(FeatureCards, { projectId: 'p1', features: [{ ...feature, analyzedAt: page.at }, { ...feature, id: 'login', name: '로그인' }] }));
    expect(html).toContain('href="/projects/p1/features/summary"');
    expect(html).toContain('href="/projects/p1/features/login"');
    expect(html).toContain('자세한 분석');
    expect(html).toContain('기본 정보만 있음');
    expect(render(createElement(FeatureCards, { projectId: 'p1', features: [] }))).toContain('아직 주요 기능 목록이 없습니다');
  });

  it('사용자 페이지의 주요 기능 블록은 탭과 같은 목록을 기능 페이지 링크로 보여 준다', () => {
    const value = { projectId: 'p1', features: [{ ...feature, analyzedAt: page.at }, { ...feature, id: 'login', name: '로그인' }] };
    const html = render(createElement(FeatureContext.Provider, { value }, createElement(Block, { b: { kind: 'features', ids: ['login', 'missing'] } })));
    expect(html).toContain('href="/projects/p1/features/login"');
    expect(html).not.toContain('/features/summary');
  });
});
