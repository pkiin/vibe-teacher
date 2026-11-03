import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { EMAIL_RESEND_COOLDOWN_SECONDS, type ResendConfirmationResponse } from '@vibe-teacher/shared';
import { ApiError, apiPost } from '../api/client';
import { ko } from '../i18n/ko';

export function resendSecondsRemaining(readyAt: number, now = Date.now()): number {
  return Math.max(0, Math.ceil((readyAt - now) / 1000));
}

export function ResendConfirmation({ initialEmail = '', requestedAt = 0, initiallyOpen = false }: { initialEmail?: string; requestedAt?: number; initiallyOpen?: boolean }) {
  const text = ko.resendConfirmation;
  const panelId = useId();
  const [open, setOpen] = useState(initiallyOpen);
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now);
  const pending = useRef(false);
  const readyAt = Math.max(retryAt, requestedAt ? requestedAt + EMAIL_RESEND_COOLDOWN_SECONDS * 1000 : 0);
  const remaining = resendSecondsRemaining(readyAt, now);

  useEffect(() => {
    setNow(Date.now());
    if (readyAt <= Date.now()) return;
    const timer = window.setInterval(() => {
      const next = Date.now();
      setNow(next);
      if (next >= readyAt) window.clearInterval(timer);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [readyAt]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (pending.current || resendSecondsRemaining(readyAt) > 0) return;
    pending.current = true;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await apiPost<ResendConfirmationResponse>('/api/auth/resend-confirmation', { email: email.trim() });
      if (result?.requested !== true) throw new Error('invalid_resend_result');
      const seconds = Number.isFinite(result.retryAfterSeconds) ? Math.min(86_400, Math.max(EMAIL_RESEND_COOLDOWN_SECONDS, result.retryAfterSeconds)) : EMAIL_RESEND_COOLDOWN_SECONDS;
      setRetryAt(Date.now() + seconds * 1000);
      setMessage(text.requested);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : text.failed);
      if (e instanceof ApiError && e.status === 429) setRetryAt(Date.now() + EMAIL_RESEND_COOLDOWN_SECONDS * 1000);
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };

  return <section className="email-resend">
    <button className="link" type="button" aria-expanded={open} aria-controls={panelId} onClick={() => {
      if (!open && initialEmail) setEmail(initialEmail);
      setOpen(!open);
    }}>{text.help}</button>
    {open && <div id={panelId}>
      <p className="muted small">{text.hint}</p>
      <form className="form-grid" onSubmit={submit}>
        <label className="field">{ko.cloudLogin.email}<input type="email" autoComplete="email" maxLength={254} required value={email} disabled={busy} onChange={(e) => setEmail(e.target.value)} /></label>
        {error && <p className="notice notice-error" role="alert">{error}</p>}
        {message && <p className="notice" role="status">{message}</p>}
        <button className="btn" type="submit" disabled={busy || remaining > 0}>{busy ? text.sending : remaining > 0 ? text.wait(remaining) : text.submit}</button>
        <p className="muted small">{text.limitNote}</p>
      </form>
    </div>}
  </section>;
}
