import { useEffect, useState } from 'react';
import { OPEN_SETTINGS_EVENT, useDisplay } from '../context/DisplayContext';
import { useReader } from '../hooks/useReader';
import { ko } from '../i18n/ko';
import { Modal } from './Modal';
import { ReaderLevelOptions } from './ReaderLevelPicker';
import { ThemePicker } from './ThemePicker';

export function SettingsPopover() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const { prefs, update, reset } = useDisplay();
  const reader = useReader();
  const [level, setLevel] = useState(reader.level);
  useEffect(() => { if (!busy) setLevel(reader.level); }, [reader.level, busy]);
  useEffect(() => { const open = () => setOpen(true); window.addEventListener(OPEN_SETTINGS_EVENT, open); return () => window.removeEventListener(OPEN_SETTINGS_EVENT, open); }, []);
  return <>
    <button type="button" className="btn settings-trigger" aria-label={ko.settings.open} title={ko.settings.open} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m9 3-.6 2.2-2 .9-2-.6L2 9l1.5 1.6v2.8L2 15l2.4 3.5 2-.6 2 .9L9 21h6l.6-2.2 2-.9 2 .6L22 15l-1.5-1.6v-2.8L22 9l-2.4-3.5-2 .6-2-.9L15 3Z"/><circle cx="12" cy="12" r="3.5"/></svg>
    </button>
    <Modal open={open} title={ko.settings.title} onClose={() => setOpen(false)} className="settings-popover">
      <section className="settings-section">
        <h3>{ko.settings.appearance}</h3>
        <p className="small muted">{ko.settings.local}</p>
        <label className="settings-field"><span>{ko.theme.label}</span><ThemePicker /></label>
        <label className="settings-field"><span>{ko.settings.fontSize}</span><select aria-label={ko.settings.fontSize} value={prefs.fontSize} onChange={(event) => update({ fontSize: Number(event.target.value) })}>{[13, 14, 15, 16, 18].map((size) => <option key={size} value={size}>{size}px{size === 14 ? ko.settings.default : ''}</option>)}</select></label>
        <label className="settings-field"><span>{ko.settings.codeSize}</span><select aria-label={ko.settings.codeSize} value={prefs.codeSize} onChange={(event) => update({ codeSize: Number(event.target.value) })}>{[11, 12, 13, 14, 16].map((size) => <option key={size} value={size}>{size}px{size === 12 ? ko.settings.default : ''}</option>)}</select></label>
        <label className="settings-field"><span>{ko.settings.density}</span><select aria-label={ko.settings.density} value={prefs.density} onChange={(event) => update({ density: event.target.value === 'comfortable' ? 'comfortable' : 'compact' })}><option value="compact">{ko.settings.compact}</option><option value="comfortable">{ko.settings.comfortable}</option></select></label>
        <div className="settings-preview"><span>{ko.settings.preview}</span><code>{ko.settings.codePreview}</code></div>
        <button type="button" className="link small" onClick={reset}>{ko.settings.reset}</button>
      </section>
      {reader.available && <section className="settings-section">
        <h3>{ko.reader.title}</h3><p className="small muted">{ko.settings.readerNote}</p>
        <ReaderLevelOptions value={level} showExamples={false} disabled={busy} onChange={(next) => {
          setLevel(next); setBusy(true); setError(null);
          void reader.setLevel(next).catch((e: Error) => { setLevel(reader.level); setError(e); }).finally(() => setBusy(false));
        }} />
        {busy && <p className="small" role="status">{ko.settings.saving}</p>}
        {error && <p className="notice notice-error" role="alert">{error.message}</p>}
      </section>}
    </Modal>
  </>;
}
