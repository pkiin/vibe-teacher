import { useEffect, useRef, useState } from 'react';
import { READER_LEVELS, type ReaderLevel } from '@vibe-teacher/shared';
import { useReader } from '../hooks/useReader';
import { ko } from '../i18n/ko';

/** 네 가지 수준과 같은 사실을 수준마다 어떻게 쓰는지 보여 주는 선택지 */
export function ReaderLevelOptions({ value, onChange, disabled }: { value: ReaderLevel; onChange: (level: ReaderLevel) => void; disabled?: boolean }) {
  return (
    <div className="reader-options" role="radiogroup" aria-label={ko.reader.title}>
      {READER_LEVELS.map((l) => {
        const t = ko.reader.levels[l]!;
        return (
          <label key={l} className={`reader-option ${value === l ? 'selected' : ''}`}>
            <input type="radio" name="reader-level" checked={value === l} disabled={disabled} onChange={() => onChange(l)} />
            <span>
              <strong>{t.label}</strong>
              {l === 'non-dev' && <span className="pill pill-outline small reader-default">{ko.reader.default}</span>}
              <div className="small muted">{t.desc}</div>
              <div className="small reader-example">
                <span className="muted">{ko.reader.example}: </span>
                {t.example}
              </div>
            </span>
          </label>
        );
      })}
    </div>
  );
}

/** 처음 한 번: AI 가 문장을 쓰기 전에 읽는 사람 수준을 묻는다 (기본 비개발자) */
export function ReaderLevelSetup() {
  const { level, setLevel } = useReader();
  const [pick, setPick] = useState<ReaderLevel>(level);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await setLevel(pick);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card reader-setup">
      <h2>{ko.reader.setupTitle}</h2>
      <p className="small">{ko.reader.setupIntro}</p>
      <ReaderLevelOptions value={pick} onChange={setPick} disabled={busy} />
      <p className="small muted">{ko.reader.note}</p>
      {error && <div className="llm-choice-reason">{error}</div>}
      <button className="btn btn-primary" disabled={busy} onClick={save}>
        {ko.reader.start(ko.reader.levels[pick]!.label)}
      </button>
    </section>
  );
}

/** 상단 메뉴의 "읽는 수준" 단추. 누르면 선택지가 펼쳐지고, 고르면 바로 저장한다 */
export function ReaderLevelSwitch() {
  const { level, setLevel } = useReader();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);
  const choose = async (l: ReaderLevel) => {
    setBusy(true);
    try {
      await setLevel(l);
      setOpen(false);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="reader-switch" ref={ref}>
      <button className="btn btn-small" aria-expanded={open} onClick={() => setOpen((o) => !o)} title={ko.reader.title}>
        {ko.reader.chip(ko.reader.levels[level]!.label)}
      </button>
      {open && (
        <div className="reader-popover card">
          <strong>{ko.reader.title}</strong>
          <ReaderLevelOptions value={level} onChange={(l) => void choose(l)} disabled={busy} />
          <p className="small muted">{ko.reader.note}</p>
        </div>
      )}
    </div>
  );
}

/** 문서 위에 붙이는 한 줄: "읽는 사람: 비개발자 · 바꾸기" */
export function ReaderLevelLine() {
  const { level, setLevel } = useReader();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <div className="small reader-line">
      <span className="muted">{ko.reader.line(ko.reader.levels[level]!.label)}</span>{' '}
      <button className="link" onClick={() => setOpen((o) => !o)}>
        {open ? ko.reader.close : ko.reader.change}
      </button>
      {open && (
        <ReaderLevelOptions
          value={level}
          disabled={busy}
          onChange={(l) => {
            setBusy(true);
            void setLevel(l).finally(() => {
              setBusy(false);
              setOpen(false);
            });
          }}
        />
      )}
    </div>
  );
}
