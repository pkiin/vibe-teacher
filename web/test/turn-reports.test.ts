import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BuiltSummaryView } from '../src/components/BuiltSummary';
import { MiniMarkdown } from '../src/components/MiniMarkdown';
import { summarizeBuilt } from '../../server/src/analyzers/built/index';
import { fakeSession } from '../../server/test/wiki/helpers';
import { ko } from '../src/i18n/ko';

describe('만들어진 것의 작업 보고', () => {
  it('마지막 보고를 먼저 펼쳐 보여 주고 긴 원문·요청·이전 답변을 모두 보존한다', () => {
    const report = '## 마지막 작업 결과\n\n' + '긴 설명입니다. '.repeat(1000) + '\n\n**끝까지 보이는 결과**';
    const session = fakeSession([{ human: '이전 요청' }, { assistant: '이전 결과' }, { human: '기능을 추가하고 결과를 설명해 줘' }, { write: 'src/app.ts' }, { assistant: report }]);
    const html = renderToStaticMarkup(createElement(BuiltSummaryView, { built: summarizeBuilt(session) }));
    expect(html).toContain('끝까지 보이는 결과</strong>');
    expect(html).toContain('이전 결과');
    expect(html).toContain('기능을 추가하고 결과를 설명해 줘');
    expect(html.indexOf('마지막 작업 결과')).toBeLessThan(html.indexOf('이전 결과'));
    expect(html).toMatch(/<details class="turn-report" open="">[\s\S]*?요청 2/);
    expect(html).toMatch(/<details class="turn-report"><summary>[\s\S]*?요청 1/);
    expect(html.indexOf(ko.built.reports)).toBeLessThan(html.indexOf(ko.built.activityTitle));
    expect(html).toContain('<pre>' + report + '</pre>');
  });

  it('아직 최종 답변이 없는 요청의 진행 알림을 결과로 보여 주지 않는다', () => {
    const session = fakeSession([{ human: '추가 요청' }, { assistant: '이제 파일을 살펴보겠습니다.' }, { write: 'src/app.ts' }]);
    const html = renderToStaticMarkup(createElement(BuiltSummaryView, { built: summarizeBuilt(session) }));
    expect(html).toContain(ko.built.noReportYet);
    expect(html).toContain(ko.built.pendingReport);
    expect(html).not.toContain('이제 파일을 살펴보겠습니다.');
  });
});

describe('보고의 마크다운 표시', () => {
  it('제목·중첩 목록·표·코드·문서 링크를 읽을 수 있는 형태로 표시한다', () => {
    const text = '# 구현한 것\n\n- **로그인** 추가\n  - 세부 확인\n\n| 기능 | 결과 |\n| --- | --- |\n| `a|b` | 성공 \\| 확인 |\n\n```ts\nconst done = true;\n```\n\n[공식 문서](https://example.test/docs)';
    const html = renderToStaticMarkup(createElement(MiniMarkdown, { text }));
    for (const part of ['<h4>구현한 것</h4>', '<strong>로그인</strong>', '세부 확인', '<table', '<td><code>a|b</code></td>', '성공 | 확인', 'syntax-keyword', 'const', 'href="https://example.test/docs"']) expect(html).toContain(part);
    expect(html.match(/<ul>/g)).toHaveLength(2);
    expect(html).not.toContain('```');
  });

  it('원문 HTML·위험한 링크·외부 이미지를 실행하지 않고 파일 경로와 닫히지 않은 코드도 보존한다', () => {
    const text = '<script>alert(1)</script>\n\n[위험](javascript:alert) [파일](</workspace/demo/app.ts:12>) ![이미지](https://example.test/track.png)\n\n```text\n마지막 코드 줄';
    const html = renderToStaticMarkup(createElement(MiniMarkdown, { text }));
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('href="javascript:');
    expect(html).not.toContain('<img');
    expect(html).toContain('/workspace/demo/app.ts:12');
    expect(html).toContain('마지막 코드 줄');
  });
});
