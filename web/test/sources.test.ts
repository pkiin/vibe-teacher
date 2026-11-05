import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { AuthMeResponse } from '@vibe-teacher/shared';
import { SourcesPage } from '../src/pages/SourcesPage';

const state = vi.hoisted(() => ({ me: null as AuthMeResponse | null }));
vi.mock('../src/context/AuthContext', () => ({ useAuth: () => ({ me: state.me, refresh: async () => {} }) }));
vi.mock('../src/hooks/useApi', () => ({ useApi: () => ({ data: null, error: null, loading: false, reload: () => {} }) }));

const render = (me: Partial<AuthMeResponse>) => {
  state.me = { mode: 'supabase', authenticated: true, isAdmin: true, canManageInstallation: true, ...me } as AuthMeResponse;
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(SourcesPage)));
};

describe('소스 설정 화면', () => {
  it('SSH 터널 서버에 다른 계정으로 접속하면 스캔 범위를 숨기고 나머지 설정은 보여 준다', () => {
    const html = render({ deployment: 'ssh', osUser: 'user99', canManageScan: false });
    expect(html).not.toContain('<h2>스캔 범위</h2>');
    expect(html).not.toContain('/home 전체 (모든 계정)');
    expect(html).toContain('<h2>기록 위치</h2>');
  });

  it('서버 실행 계정으로 접속한 관리자에게는 스캔 범위를 보여 준다', () => {
    const html = render({ deployment: 'ssh', osUser: 'ubuntu', canManageScan: true });
    expect(html).toContain('<h2>스캔 범위</h2>');
    expect(html).toContain('/home 전체 (모든 계정)');
  });
});
