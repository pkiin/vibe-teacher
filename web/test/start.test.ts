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

  it('SSH 터널 서버에서는 접속한 OS 계정을 알리고 확인하지 못하면 기록을 보여 주지 않는다고 안내한다', () => {
    const before = state.me;
    try {
      state.me = { mode: 'supabase', authenticated: true, deployment: 'ssh', approved: true, osUser: 'user99' } as AuthMeResponse;
      let html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(StartPage)));
      expect(html).toContain('SSH 터널 개발 서버에서 실행 중');
      expect(html).toContain('접속한 SSH 계정: user99');
      expect(html).not.toContain('다른 계정에 연결되어');
      state.me = { ...state.me, osUser: null };
      html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(StartPage)));
      expect(html).toContain('접속한 OS 계정을 확인하지 못해');
    } finally {
      state.me = before;
    }
  });

  it('노트북 설치에 OpenRouter 키가 없으면 시작 화면에서 키를 받고, 저장한 키는 다시 보여 주지 않는다', () => {
    const before = state.me;
    try {
      state.me = { ...before, openRouterKey: 'none' };
      let html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(StartPage)));
      expect(html).toContain('AI 설명을 쓰려면 OpenRouter 키를 넣어 주세요');
      expect(html).toContain('type="password"');
      expect(html).toContain('관리자가 준 키가 있으면 그 키를');
      expect(html).toContain('href="https://openrouter.ai/keys"');
      state.me = { ...before, openRouterKey: 'saved' };
      html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(StartPage)));
      expect(html).toContain('OpenRouter 키 저장됨');
      expect(html).not.toContain('OpenRouter 키를 넣어 주세요');
      // 키를 관리하지 않는 사용자(출처 정보 없음)에게는 입력 칸을 보이지 않는다.
      state.me = { ...before };
      html = renderToStaticMarkup(createElement(MemoryRouter, null, createElement(StartPage)));
      expect(html).not.toContain('OpenRouter 키');
    } finally {
      state.me = before;
    }
  });

  it('이메일 로그인과 회원가입 진입을 표시하며 서버 토큰 파일을 요구하지 않는다', () => {
    const html = renderToStaticMarkup(createElement(LoginPage));
    expect(html).toContain('type="email"');
    expect(html).toContain('type="password"');
    expect(html).toContain('회원가입');
    expect(html).toContain('같은 계정으로 로그인');
    expect(html).toContain('인증 메일이 안 왔어요');
    expect(html).not.toContain('setfacl');
    expect(html).not.toContain('login-token');
  });
});
