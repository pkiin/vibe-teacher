import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import type { RepoUsageSection } from '@vibe-teacher/shared';
import { GuideView, filterGuide } from '../src/components/GuideView';
import { ko } from '../src/i18n/ko';

const sections: RepoUsageSection[] = [{
  id: 'u1', title: '메모 화면', where: '첫 화면', intro: '메모를 써요.',
  parts: [{ items: [
    { name: '메모 저장', label: '메모 저장', what: '쓴 메모를 저장해요.', tip: '쓴 뒤 바로 눌러 보세요.', sources: [{ kind: 'file', path: 'web/src/App.tsx', startLine: 7, endLine: 7 }] },
    { name: '저장 버튼', label: 'Save', what: '같은 일을 해요.', sources: [{ kind: 'file', path: 'web/src/App.tsx' }] },
    { name: '메모 칸', what: '메모를 써요.', sources: [{ kind: 'file', path: 'web/src/App.tsx' }] },
  ] }],
}];

describe('레포 위키 어떻게 사용하나요?', () => {
  it('앱의 사용 방법과 같은 모양(처음 순서 · 화면별 버튼 → 하는 일 → 쓰면 좋은 때 · 자주 묻는 질문)에 근거와 확인한 화면 문구를 붙여 그린다', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(GuideView, {
      idPrefix: 'usage',
      steps: [{ title: '메모 쓰기', text: '칸에 쓰고 저장을 눌러요.', sources: [] }],
      sections,
      faq: [{ q: '어디에 저장되나요?', a: '서버로 보내요.', sources: [] }],
      placeholder: ko.usage.searchPlaceholder,
      sources: (s) => createElement('span', { className: 'test-sources' }, String(s?.length ?? 0)),
    })));
    expect(html).toContain('id="usage-u1"');
    expect(html).toContain('href="#usage-u1"');
    expect(html).toContain('id="usage-faq"');
    expect(html).toContain('id="usage-search"');
    expect(html).toContain(ko.guide.flowTitle);
    expect(html).toContain(ko.guide.tip);
    // 화면 문구가 이름과 같으면 확인 표시, 다르면 실제 문구를, 확인하지 못했으면 아무것도 붙이지 않는다
    expect(html).toContain(ko.usage.labelSame);
    expect(html).toContain('“Save”');
    expect(html.match(/class="guide-label/g)).toHaveLength(2);
    // 항목·단계·질문마다 근거 표시를 그린다
    expect(html.match(/class="test-sources"/g)).toHaveLength(5);
  });

  it('찾기 칸은 화면 문구로도 찾는다', () => {
    expect(filterGuide(sections, 'save')[0]!.parts[0]!.items.map((i) => i.name)).toEqual(['저장 버튼']);
    expect(filterGuide(sections, '없는낱말')).toEqual([]);
  });

  it('레포 위키 탭 이름과 사용 방법 탭 안내가 있다', () => {
    expect(ko.repo.views.usage).toBe('어떻게 사용하나요?');
    expect(ko.repo.viewNote.usage).toBeTruthy();
  });
});
