import { useEffect, useState, type FormEvent } from 'react';
import { api } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { ko } from '../i18n/ko';

export function LoginPage() {
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
