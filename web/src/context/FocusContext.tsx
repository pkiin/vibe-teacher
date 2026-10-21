import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import type { HelpFocus } from '@vibe-teacher/shared';

export type PanelTab = 'explain' | 'ask' | 'quiz';

export interface FocusApi {
  focus: HelpFocus;
  tab: PanelTab;
  setTab: (tab: PanelTab) => void;
  /** 도움 패널을 이 대상으로 바꾼다 (좁은 화면에서는 서랍을 연다) */
  show: (focus: HelpFocus, tab?: PanelTab) => void;
  /** 이 세션에서 도움 패널로 질문한 개념 — 그 개념의 문제 응답은 보조(assisted)로 기록한다 */
  helped: ReadonlySet<string>;
  markHelped: (conceptIds: string[]) => void;
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
}

const Ctx = createContext<FocusApi | null>(null);

/** 통합 화면 안에서만 쓰는 "지금 보고 있는 대상". 바깥에서는 null 이라 각 카드가 제자리 동작으로 돌아간다 */
export function useFocus(): FocusApi | null {
  return useContext(Ctx);
}

export function FocusProvider({ children }: { children: ReactNode }) {
  const [focus, setFocus] = useState<HelpFocus>({ kind: 'session' });
  const [tab, setTab] = useState<PanelTab>('explain');
  const [helped, setHelped] = useState<Set<string>>(new Set());
  const [drawerOpen, setDrawerOpen] = useState(false);

  const show = useCallback((f: HelpFocus, t: PanelTab = 'explain') => {
    setFocus(f);
    setTab(t);
    setDrawerOpen(true);
  }, []);
  const markHelped = useCallback((ids: string[]) => {
    setHelped((s) => (ids.every((id) => s.has(id)) ? s : new Set([...s, ...ids])));
  }, []);

  const value = useMemo(() => ({ focus, tab, setTab, show, helped, markHelped, drawerOpen, setDrawerOpen }), [focus, tab, show, helped, markHelped, drawerOpen]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
