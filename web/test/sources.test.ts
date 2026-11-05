import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { AuthMeResponse } from '@vibe-teacher/shared';
import { Layout } from '../src/components/Layout';
import { SourcesPage } from '../src/pages/SourcesPage';

const state = vi.hoisted(() => ({ me: null as AuthMeResponse | null }));
vi.mock('../src/context/AuthContext', () => ({ useAuth: () => ({ me: state.me, refresh: async () => {}, logout: async () => {} }) }));
vi.mock('../src/hooks/useApi', () => ({ useApi: () => ({ data: null, error: null, loading: false, reload: () => {} }) }));
// 탭 표시만 검사하므로 화면 설정·진행 표시·수준 선택은 비운다.
vi.mock('../src/components/SettingsPopover', () => ({ SettingsPopover: () => null }));
vi.mock('../src/components/NetworkActivity', () => ({ NetworkActivity: () => null }));
vi.mock('../src/components/ReaderLevelPicker', () => ({ ReaderLevelSetup: () => null }));

const render = (me: Partial<AuthMeResponse>) => {
  state.me = { mode: 'supabase', authenticated: true, isAdmin: true, deployment: 'ssh', ...me } as AuthMeResponse;
  const nav = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(Layout, null, null)));
  const page = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SourcesPage)));
  return { nav, page };
};

describe('소스 설정 탭', () => {
  it('SSH 터널 서버에 다른 계정으로 접속한 관리자에게는 탭과 화면을 보여 주지 않고 회원 관리는 남긴다', () => {
    const { nav, page } = render({ osUser: 'user99', canManageInstallation: false });
    expect(nav).not.toContain('href="/sources"');
    expect(nav).toContain('href="/members"');
    expect(page).not.toContain('<h2>스캔 범위</h2>');
  });

  it('서버 실행 계정으로 접속한 관리자에게는 탭과 스캔 범위를 보여 준다', () => {
    const { nav, page } = render({ osUser: 'ubuntu', canManageInstallation: true });
    expect(nav).toContain('href="/sources"');
    expect(page).toContain('<h2>스캔 범위</h2>');
    expect(page).toContain('/home 전체 (모든 계정)');
  });
});
