import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type Theme = 'system' | 'light' | 'dark';
export interface DisplayPrefs { theme: Theme; fontSize: number; codeSize: number; density: 'compact' | 'comfortable' }
const KEY = 'vibe-teacher-display';
const THEME_KEY = 'vibe-teacher-theme';
const DEFAULTS: DisplayPrefs = { theme: 'system', fontSize: 14, codeSize: 12, density: 'compact' };
const validTheme = (value: unknown): Theme => value === 'light' || value === 'dark' ? value : 'system';
function read(): DisplayPrefs {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<DisplayPrefs>;
    return {
      theme: validTheme(localStorage.getItem(THEME_KEY) ?? raw.theme),
      fontSize: [13, 14, 15, 16, 18].includes(Number(raw.fontSize)) ? Number(raw.fontSize) : 14,
      codeSize: [11, 12, 13, 14, 16].includes(Number(raw.codeSize)) ? Number(raw.codeSize) : 12,
      density: raw.density === 'comfortable' ? 'comfortable' : 'compact',
    };
  } catch { return DEFAULTS; }
}
const Context = createContext<{ prefs: DisplayPrefs; update: (patch: Partial<DisplayPrefs>) => void; reset: () => void } | null>(null);

/** 화면 설정은 이 브라우저에 저장하며 설명 난이도·이해 기록과 분리한다. */
export function DisplayProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState(read);
  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const root = document.documentElement;
      root.dataset.theme = prefs.theme === 'system' ? media.matches ? 'dark' : 'light' : prefs.theme;
      root.dataset.density = prefs.density;
      root.style.setProperty('--ui-font-size', `${prefs.fontSize}px`);
      root.style.setProperty('--code-font-size', `${prefs.codeSize}px`);
    };
    const sync = (event: StorageEvent) => { if (!event.key || event.key === KEY || event.key === THEME_KEY) setPrefs(read()); };
    apply();
    media.addEventListener('change', apply);
    window.addEventListener('storage', sync);
    return () => { media.removeEventListener('change', apply); window.removeEventListener('storage', sync); };
  }, [prefs]);
  const save = (next: DisplayPrefs) => {
    setPrefs(next);
    try { localStorage.setItem(KEY, JSON.stringify(next)); localStorage.setItem(THEME_KEY, next.theme); } catch { /* 저장이 차단돼도 현재 화면에는 적용한다. */ }
  };
  return <Context.Provider value={{ prefs, update: (patch) => save({ ...prefs, ...patch }), reset: () => save(DEFAULTS) }}>{children}</Context.Provider>;
}

export function useDisplay() {
  const context = useContext(Context);
  if (!context) throw new Error('화면 설정을 불러오지 못했습니다');
  return context;
}

export const OPEN_SETTINGS_EVENT = 'vibe-teacher:settings';
export const openSettings = () => window.dispatchEvent(new Event(OPEN_SETTINGS_EVENT));
