import type { HelpFocus } from '@vibe-teacher/shared';
import { useFocus, type PanelTab } from '../context/FocusContext';

/** 개념·항목·파일 이름. 통합 화면 안에서는 누르면 도움 패널로 연다 */
export function FocusChip({ focus, label, tab, className = 'pill pill-outline' }: { focus: HelpFocus; label: string; tab?: PanelTab; className?: string }) {
  const f = useFocus();
  if (!f) return <span className={className}>{label}</span>;
  return (
    <button type="button" className={`${className} focus-chip`} onClick={() => f.show(focus, tab)}>
      {label}
    </button>
  );
}
