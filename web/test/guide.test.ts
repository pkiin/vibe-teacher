import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { Account, AuthMeResponse } from '@vibe-teacher/shared';
import { GuidePage, filterGuide, guideViewer, visibleGuide } from '../src/pages/GuidePage';
import { guideFaq, guideSections, guideSteps } from '../src/i18n/guide';
import { ko } from '../src/i18n/ko';
import { Layout } from '../src/components/Layout';

/** 일반 회원: 승인됨, 설치 관리 권한 없음, 완전 비개발자 수준, 계정 하나 */
const member = { mode: 'supabase', authenticated: true, deployment: 'shared', approved: true, reader: { readerLevel: 'non-dev', chosen: true } } as unknown as AuthMeResponse;
/** 노트북 설치 소유자: 승인 대기, 키 없음, 주니어 수준 */
const owner = { ...member, deployment: 'local', approved: false, canManageInstallation: true, openRouterKey: 'none', reader: { readerLevel: 'junior', chosen: true } } as unknown as AuthMeResponse;
const account = (id: string, readable: Account['readable'] = 'ok') => ({ id, username: id, readable, sessionCount: 1 }) as unknown as Account;
const state = vi.hoisted(() => ({ me: null as unknown as AuthMeResponse, accounts: [] as Account[] }));
state.me = member;
vi.mock('../src/context/AuthContext', () => ({ useAuth: () => ({ me: state.me, refresh: async () => {}, logout: async () => {} }) }));
vi.mock('../src/hooks/useApi', () => ({ useApi: (path: string | null) => ({ data: path === '/api/accounts' ? state.accounts : null, error: null, loading: false, reload: () => {} }) }));
vi.mock('../src/components/SettingsPopover', () => ({ SettingsPopover: () => null }));

const render = (me: AuthMeResponse = member, accounts: Account[] = [account('a')]) => {
  state.me = me;
  state.accounts = accounts;
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(GuidePage)));
};
/** 안내 항목 이름으로 그려졌는지 (설명 문장 속에 같은 말이 있어도 헷갈리지 않게) */
const hasItem = (html: string, name: string) => html.includes(`<span class="guide-name">${name}</span>`);
/** 권한·설정에 따라 보이는 항목 */
const gated = [ko.nav.sources, `${ko.nav.accountSelect} 선택 칸`, '계정 카드', ko.start.checkApproval, ko.openRouterKey.save, ko.aiUnified.preview];
/** 안내에 쓰인 모든 문장 */
const allTexts = () => [
  ...guideSteps.flatMap((s) => [s.title, s.text]),
  ...guideSections.flatMap((s) => [s.title, s.where, s.intro, ...s.parts.flatMap((p) => [p.title ?? '', ...p.items.flatMap((i) => [i.name, i.what, i.tip ?? ''])])]),
  ...guideFaq.flatMap((f) => [f.q, f.a]),
];

describe('사용 방법 탭', () => {
  it('위쪽 메뉴에서 모든 사용자에게 사용 방법 탭을 시작하기 바로 옆에 보여 준다', () => {
    state.me = member;
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Layout, null, createElement('p', null, '본문'))));
    expect(html).toContain(ko.nav.guide);
    const links = [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]).filter((href) => href !== '#main-content');
    // 로고(/) 다음이 시작하기(/), 그 바로 다음이 사용 방법
    expect(links.slice(0, 4)).toEqual(['/', '/', '/guide', '/accounts']);
  });

  it('맨 위에서 웹 앱·웹 서비스 기준이라는 지원 범위를 처음 순서보다 먼저 알린다', () => {
    const html = render();
    expect(html).toContain(ko.guide.supportTitle);
    expect(html).toContain(ko.guide.supportText);
    expect(html.indexOf(ko.guide.supportTitle)).toBeGreaterThan(html.indexOf(ko.guide.intro));
    expect(html.indexOf(ko.guide.supportTitle)).toBeLessThan(html.indexOf(ko.guide.flowTitle));
  });

  it('일반 회원에게는 그 사람 화면에 보이지 않는 메뉴와 버튼을 안내하지 않는다', () => {
    const html = render();
    for (const name of gated) expect(hasItem(html, name), name).toBe(false);
    expect(hasItem(html, ko.login.logout)).toBe(true);
    expect(html).not.toContain('승인 대기 중”이라고 나와요');
    expect(html).toContain('내 학습 기록은 누가 볼 수 있나요?');
    expect(html).toContain(ko.guide.mine);
  });

  it('권한과 설정이 있는 사람에게는 그 버튼의 안내를 함께 보여 준다', () => {
    const html = render(owner, [account('a'), account('b'), account('c', 'denied')]);
    for (const name of gated) expect(hasItem(html, name), name).toBe(true);
    expect(html).toContain('승인 대기 중”이라고 나와요');
    // 계정이 하나라도 읽을 수 없으면 계정 카드 화면이 보인다
    expect(guideViewer(member, false, [account('x', 'denied')]).accountCards).toBe(true);
    expect(guideViewer(member, false, [account('x')]).accountCards).toBe(false);
    // 관리자는 설명 난이도와 관계없이 기술 정보를 본다 (useTechnicalDetails 가 정한 값을 그대로 쓴다)
    expect(guideViewer({ ...member, isAdmin: true }, true, null).technical).toBe(true);
    // 로그인하지 않는 설치에서는 로그아웃·회원 안내를 빼고, 비게 된 묶음은 지운다
    const none = guideViewer({ ...member, mode: 'none', authenticated: false } as AuthMeResponse, false, null);
    expect(none.signedIn || none.member || none.pending).toBe(false);
    const start = visibleGuide(guideSections, none).find((s) => s.id === 'start')!;
    expect(start.parts.map((p) => p.title)).not.toContain('이럴 때만 보여요');
  });

  it('처음 순서, 화면별 절과 목차, 자주 묻는 질문을 그린다', () => {
    const html = render(owner);
    expect(html).toContain(ko.guide.flowTitle);
    for (const s of guideSections) {
      expect(html).toContain(`id="guide-${s.id}"`);
      expect(html).toContain(`href="#guide-${s.id}"`);
    }
    expect(html).toContain('id="guide-faq"');
    // 실제 화면의 버튼 이름과 하는 일, 쓰면 좋은 때가 함께 보인다
    expect(html).toContain(ko.aiUnified.run);
    expect(html).toContain(ko.repo.build);
    expect(html).toContain(ko.knowledge.quiz);
    expect(html).toContain(ko.guide.tip);
    expect(html).toContain('href="/knowledge"');
  });

  it('주요 화면과 버튼을 빠뜨리지 않고, 비어 있거나 빠진 문구가 없다', () => {
    const names = new Set(guideSections.flatMap((s) => s.parts.flatMap((p) => p.items.map((i) => i.name))));
    for (const label of [
      ko.start.copy, ko.start.edit, ko.repo.update, ko.repo.preview, ko.feature.analyze, ko.session.tabs.messages, ko.session.tabs.built, ko.common.copyAll,
      ko.aiUnified.rerun, ko.wiki.simpler, ko.wiki.deeper, ko.understanding.known, ko.understanding.unsure, ko.help.examples, ko.quiz.dontKnow, ko.quiz.skip,
      ko.knowledge.wrong, ko.knowledge.dashboard.title, ko.memory.search, ko.settings.fontSize, ko.reader.title, ko.guide.fromStartLink, ko.repo.views.usage!, ko.usage.analyze, ko.usage.labelSame,
    ]) expect(names, label).toContain(label);
    for (const text of allTexts()) expect(text).not.toMatch(/undefined|\[object /);
    for (const s of guideSections) {
      expect(s.parts.length).toBeGreaterThan(0);
      for (const p of s.parts) {
        const itemNames = p.items.map((i) => i.name);
        expect(new Set(itemNames).size, `${s.id} ${p.title ?? ''}`).toBe(itemNames.length);
        for (const i of p.items) expect(i.what.length, i.name).toBeGreaterThan(10);
      }
    }
    expect(new Set(guideSections.map((s) => s.id)).size).toBe(guideSections.length);
  });

  it('쓰는 사람 입장만 다루고 관리자 화면은 안내하지 않는다', () => {
    const text = allTexts().join('\n');
    expect(text).not.toContain(ko.members.nav);
    expect(text).not.toContain(ko.members.title);
    expect(text).not.toContain(ko.sources.scanTitle);
    expect(text).not.toContain('VIBE_TEACHER_');
  });
  it('화면에서 숨겨 둔 보안 점검은 안내하지 않는다', () => {
    const text = allTexts().join('\n');
    for (const name of [ko.security.title, ko.repo.views.security!, ko.reading.security, ko.analysis.sections.security]) expect(text).not.toContain(name);
    expect(text).not.toContain('보안 주의사항');
  });

  it('찾기 칸에 넣은 말이 들어 있는 항목만 남기고, 절 제목이 맞으면 절 전체를 남긴다', () => {
    const hit = filterGuide(guideSections, '  모르겠어요 ');
    const items = hit.flatMap((s) => s.parts.flatMap((p) => p.items));
    expect(items.length).toBeGreaterThan(0);
    for (const i of items) expect(`${i.name}${i.what}${i.tip ?? ''}`).toContain('모르겠어요');
    expect(filterGuide(guideSections, '없는낱말없는낱말')).toEqual([]);
    expect(filterGuide(guideSections, '')).toBe(guideSections);
    const settings = guideSections.find((s) => s.id === 'settings')!;
    expect(filterGuide(guideSections, settings.title)).toContainEqual(settings);
    // 영문 버튼 이름은 대소문자를 가리지 않는다
    expect(filterGuide(guideSections, 'ox').length).toBeGreaterThan(0);
  });
});
