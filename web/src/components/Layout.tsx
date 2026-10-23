import { useEffect, useState, type ReactNode } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router';
import type { Account } from '@vibe-teacher/shared';
import { getToken, onUnauthorized, setToken } from '../api/client';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks/useApi';
import { ko } from '../i18n/ko';
import { ReaderLevelSetup } from './ReaderLevelPicker';
import { SettingsPopover } from './SettingsPopover';

export function Layout({ children }: { children: ReactNode }) {
  const { me, logout } = useAuth();
  const [needToken, setNeedToken] = useState(false);
  const [tokenInput, setTokenInput] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const canQuery = !!me && (me.authenticated || me.mode === 'none');
  const accounts = useApi<Account[]>(canQuery ? '/api/accounts' : null, [needToken, me?.username]);

  useEffect(() => onUnauthorized(() => (me?.mode === 'none' ? setNeedToken(true) : undefined)), [me?.mode]);

  const readable = (accounts.data ?? []).filter((a) => a.readable === 'ok');
  const currentAccountId = /^\/accounts\/([^/]+)/.exec(location.pathname)?.[1] ?? '';
  const isAdmin = !!me?.isAdmin;

  return (
    <div className="layout">
      <a className="skip-link" href="#main-content">{ko.reading.skip}</a>
      <header className="topbar">
        <Link to="/" className="brand">
          <span className="brand-name">{ko.appName}</span>
          <span className="brand-tagline">{ko.tagline}</span>
        </Link>
        <nav className="nav">
          {readable.length > 1 && (
            <select className="account-select" value={currentAccountId} onChange={(e) => e.target.value && navigate(`/accounts/${e.target.value}`)} aria-label={ko.nav.accounts}>
              <option value="">{ko.nav.accounts}…</option>
              {readable.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.username} ({a.sessionCount})
                </option>
              ))}
            </select>
          )}
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
            {ko.nav.accounts}
          </NavLink>
          <NavLink to="/knowledge" className={({ isActive }) => (isActive ? 'active' : '')}>
            {ko.knowledge.nav}
          </NavLink>
          {isAdmin && (
            <NavLink to="/sources" className={({ isActive }) => (isActive ? 'active' : '')}>
              {ko.nav.sources}
            </NavLink>
          )}
          {me?.mode === 'home-token' && me.authenticated && (
            <span className="user-chip">
              <span className="mono">{me.username}</span>
              {isAdmin && <span className="pill pill-blue">{ko.login.admin}</span>}
              <button className="link" onClick={() => void logout()}>
                {ko.login.logout}
              </button>
            </span>
          )}
          <SettingsPopover />
        </nav>
      </header>
      {needToken && (
        <div className="token-gate">
          <p>{ko.login.bearerNotice}</p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setToken(tokenInput.trim() || null);
              setNeedToken(false);
              window.location.reload();
            }}
          >
            <input value={tokenInput} onChange={(e) => setTokenInput(e.target.value)} placeholder="토큰" defaultValue={getToken() ?? ''} />
            <button type="submit">저장</button>
          </form>
        </div>
      )}
      <main className="content" id="main-content" tabIndex={-1}>
        {canQuery && me?.reader && !me.reader.chosen && <ReaderLevelSetup />}
        {children}
      </main>
    </div>
  );
}

export interface Crumb {
  label: string;
  to?: string;
}

export function Breadcrumb({ items }: { items: Crumb[] }) {
  return (
    <nav className="breadcrumb" aria-label="breadcrumb">
      {items.map((c, i) => (
        <span key={i} className="crumb">
          {c.to ? <Link to={c.to}>{c.label}</Link> : <span>{c.label}</span>}
          {i < items.length - 1 && <span className="sep">›</span>}
        </span>
      ))}
    </nav>
  );
}
