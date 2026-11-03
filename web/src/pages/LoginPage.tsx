import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { ko } from '../i18n/ko';

export function LoginPage() {
  const { me } = useAuth();
  return me?.mode === 'supabase' ? <CloudLoginPage /> : <HomeTokenLoginPage />;
}

function HomeTokenLoginPage() {
  const { login, me } = useAuth();
  const [username, setUsername] = useState('');
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [command, setCommand] = useState<string>('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    api<{ command: string }>('/api/auth/setup-command')
      .then((r) => setCommand(r.command))
      .catch(() => setCommand(''));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username, token);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div className="login">
      <div className="login-card card">
        <h1>{ko.login.title}</h1>
        <p className="muted">{ko.login.subtitle}</p>
        <form onSubmit={submit} className="form-grid">
          <label className="field">
            {ko.login.username}
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" placeholder="user01" autoFocus />
          </label>
          <label className="field">
            {ko.login.token}
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="current-password" placeholder={ko.login.tokenPlaceholder} />
          </label>
          {error && <div className="notice notice-error">{error}</div>}
          <div>
            <button className="btn btn-primary" type="submit" disabled={busy || !username.trim() || !token.trim()}>
              {ko.login.submit}
            </button>
          </div>
        </form>
        <details className="login-help" open>
          <summary>{ko.login.howTitle}</summary>
          <ol>
            <li>{ko.login.how1}</li>
            <li>
              {ko.login.how2(me?.serviceUser ?? '')}
              {command && (
                <div className="cmd-box">
                  <code>{command}</code>
                  <button className="btn btn-small" type="button" onClick={copy}>
                    {copied ? ko.common.copied : ko.login.copy}
                  </button>
                </div>
              )}
            </li>
            <li>{ko.login.how3}</li>
          </ol>
          <p className="muted small">{ko.login.note}</p>
        </details>
      </div>
    </div>
  );
}

function CloudLoginPage() {
  const { login, signup } = useAuth();
  const [joining, setJoining] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const text = ko.cloudLogin;
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(''); setMessage('');
    if (joining && password !== confirm) { setError(text.mismatch); return; }
    setBusy(true);
    try {
      if (joining) {
        const result = await signup(email.trim(), password);
        if (result.confirmationRequired) { setMessage(text.confirmEmail); setJoining(false); setPassword(''); setConfirm(''); }
      } else await login(email.trim(), password);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <main className="welcome-auth">
    <section className="welcome-intro">
      <span className="eyebrow">{ko.appName}</span>
      <h1>{text.title}</h1><p>{text.subtitle}</p>
      <ul className="welcome-stages">{Object.entries(ko.start.stages).map(([id, stage]) => <li key={id}><strong>{stage.title}</strong><span>{stage.description}</span></li>)}</ul>
      <p className="muted small">{text.storage}</p>
    </section>
    <section className="login-card card">
      <h2>{joining ? text.signup : text.login}</h2>
      <p className="muted">{text.accountNote}</p>
      <form className="form-grid" onSubmit={submit}>
        <label className="field">{text.email}<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="field">{text.password}<input type="password" autoComplete={joining ? 'new-password' : 'current-password'} minLength={joining ? 8 : 1} maxLength={256} required value={password} onChange={(e) => setPassword(e.target.value)} /></label>
        {joining && <label className="field">{text.confirmPassword}<input type="password" autoComplete="new-password" minLength={8} maxLength={256} required value={confirm} onChange={(e) => setConfirm(e.target.value)} /></label>}
        {joining && <p className="muted small">{text.passwordHint}</p>}
        {error && <p role="alert" className="notice notice-error">{error}</p>}
        {message && <p role="status" className="notice">{message}</p>}
        <button className="btn btn-primary" disabled={busy} type="submit">{busy ? ko.common.loading : joining ? text.signup : text.login}</button>
        <button className="link" type="button" disabled={busy} onClick={() => { setJoining(!joining); setError(''); setMessage(''); setPassword(''); setConfirm(''); }}>{joining ? text.haveAccount : text.needAccount}</button>
      </form>
    </section>
  </main>;
}
