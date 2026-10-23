import { useId, useState } from 'react';
import { READER_LEVELS, type ReaderLevel } from '@vibe-teacher/shared';
import { useReader } from '../hooks/useReader';
import { openSettings } from '../context/DisplayContext';
import { ko } from '../i18n/ko';

/** 네 가지 수준과 같은 사실을 수준마다 어떻게 쓰는지 보여 주는 선택지 */
export function ReaderLevelOptions({ value, onChange, disabled, showExamples = true }: { value: ReaderLevel; onChange: (level: ReaderLevel) => void; disabled?: boolean; showExamples?: boolean }) {
  const name = useId();
  return (
    <div className="reader-options" role="radiogroup" aria-label={ko.reader.title}>
      {READER_LEVELS.map((l) => {
        const t = ko.reader.levels[l]!;
        return (
          <label key={l} className={`reader-option ${value === l ? 'selected' : ''}`}>
            <input type="radio" name={name} checked={value === l} disabled={disabled} onChange={() => onChange(l)} />
            <span>
              <strong>{t.label}</strong>
              {l === 'non-dev' && <span className="pill pill-outline small reader-default">{ko.reader.default}</span>}
              <div className="small muted">{t.desc}</div>
              {showExamples && <div className="small reader-example">
                <span className="muted">{ko.reader.example}: </span>
                {t.example}
              </div>}
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

/** 문서의 난이도 표시는 같은 설정 팝업으로 연결한다. */
export function ReaderLevelLine() {
  const { level } = useReader();
  return <div className="small reader-line"><span className="muted">{ko.reader.line(ko.reader.levels[level]!.label)}</span>{' '}<button className="link" onClick={openSettings}>{ko.reader.change}</button></div>;
}
