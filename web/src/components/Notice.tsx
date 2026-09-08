import type { ReactNode } from 'react';

export function Notice({ kind = 'info', children }: { kind?: 'info' | 'warn' | 'error' | 'success'; children: ReactNode }) {
  return <div className={`notice notice-${kind}`}>{children}</div>;
}

export function Loading({ text = '불러오는 중…' }: { text?: string }) {
  return <div className="loading">{text}</div>;
}

export function ErrorBox({ error, onRetry }: { error: Error; onRetry?: () => void }) {
  return (
    <div className="notice notice-error">
      <span>{error.message}</span>
      {onRetry && (
        <button className="btn btn-small" onClick={onRetry}>
          다시 시도
        </button>
      )}
    </div>
  );
}

export function fmtDate(iso?: string): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('ko-KR', { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function fmtDuration(startIso?: string, endIso?: string): string {
  if (!startIso || !endIso) return '-';
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!isFinite(ms) || ms < 0) return '-';
  const min = Math.round(ms / 60000);
  if (min < 1) return '1분 미만';
  if (min < 60) return `${min}분`;
  return `${Math.floor(min / 60)}시간 ${min % 60}분`;
}

export function fmtSec(sec?: number): string {
  if (sec == null) return '';
  if (sec < 60) return `${sec}초`;
  return `${Math.floor(sec / 60)}분 ${sec % 60}초`;
}
