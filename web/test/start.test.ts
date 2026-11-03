import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import type { AuthMeResponse } from '@vibe-teacher/shared';
import { StartPage } from '../src/pages/StartPage';
import { LoginPage } from '../src/pages/LoginPage';

const state = vi.hoisted(() => ({ me: { mode: 'supabase', authenticated: true, deployment: 'local', approved: false, localOwner: true } as AuthMeResponse }));
vi.mock('../src/context/AuthContext', () => ({ useAuth: () => ({ me: state.me, refresh: async () => {}, login: async () => {}, signup: async () => ({ confirmationRequired: true }) }) }));
vi.mock('../src/hooks/useApi', () => ({ useApi: () => ({ data: { profile: null }, error: null, loading: false, reload: () => {} }) }));

describe('처음 시작하는 화면', () => {
  it('준비 단계 네 가지를 직접 선택하고 저장하기 전 안내를 생성하지 않는다', () => {
    const html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(StartPage)));
    expect(html.match(/type="radio"/g)).toHaveLength(4);
    expect(html).toContain('무엇을 만들지 고민 중이에요');
    expect(html).toContain('큰 방향은 잡았어요');
    expect(html).toContain('기능을 어느 정도 정했어요');
    expect(html).toContain('이미 작업 중인 저장소가 있어요');
    expect(html).toContain('AI 사용 승인 대기');
    expect(html).toContain('내 노트북에서 실행 중');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('AI와 시작할 첫 대화');
  });

  it('이메일 로그인과 회원가입 진입을 표시하며 서버 토큰 파일을 요구하지 않는다', () => {
    const html = renderToStaticMarkup(createElement(LoginPage));
    expect(html).toContain('type="email"');
    expect(html).toContain('type="password"');
    expect(html).toContain('회원가입');
    expect(html).toContain('같은 계정으로 로그인');
    expect(html).not.toContain('setfacl');
    expect(html).not.toContain('login-token');
  });
});
