import { useEffect, useState } from 'react';
import { ko } from '../i18n/ko';
import type { EmailConfirmationResult, EmailConfirmationStatus } from '../auth/email-confirmation';
import { ResendConfirmation } from '../components/ResendConfirmation';

export function EmailConfirmationPage({ status }: { status: EmailConfirmationStatus }) {
  const text = ko.emailConfirmation;
  const message = text.states[status];
  const checking = status === 'checking';
  const confirmed = status === 'confirmed';
  return <main className="email-confirmation">
    <section className={`card email-confirmation-card${confirmed ? ' is-confirmed' : checking ? '' : ' is-error'}`} aria-labelledby="email-confirmation-title">
      <p className="eyebrow">{ko.appName}</p>
      <ol className="email-confirmation-steps" aria-label={text.stepsLabel}>
        <li className="is-complete">{text.steps[0]}</li>
        <li aria-current="step" className={confirmed ? 'is-complete' : ''}>{text.steps[1]}</li>
        <li>{text.steps[2]}</li>
      </ol>
      <div role={checking || confirmed ? 'status' : 'alert'} aria-live="polite" aria-busy={checking}>
        <span className="email-confirmation-icon" aria-hidden="true">{checking ? '…' : confirmed ? '✓' : '!'}</span>
        <h1 id="email-confirmation-title">{message.title}</h1>
        <p className="muted">{message.description}</p>
      </div>
      {!checking && <a className="btn btn-primary" href="/">{text.login}</a>}
      {!checking && !confirmed && <ResendConfirmation initiallyOpen />}
    </section>
  </main>;
}

export function EmailConfirmationFlow({ result }: { result: Promise<EmailConfirmationResult> }) {
  const [status, setStatus] = useState<EmailConfirmationStatus>('checking');
  useEffect(() => {
    let active = true;
    void result.then((next) => { if (active) setStatus(next); });
    return () => { active = false; };
  }, [result]);
  return <EmailConfirmationPage status={status} />;
}
