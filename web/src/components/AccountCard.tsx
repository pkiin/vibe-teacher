import { Link } from 'react-router';
import type { Account } from '@vibe-teacher/shared';
import { ko } from '../i18n/ko';
import { fmtDate } from './Notice';

export function AccountCard({ account }: { account: Account }) {
  const ok = account.readable === 'ok';
  const body = (
    <>
      <div className="card-head">
        <span className="card-title">{account.username}</span>
        {account.isCurrent && <span className="pill pill-blue">{ko.accounts.current}</span>}
        <span className={`pill ${ok ? 'pill-green' : 'pill-gray'}`}>{ko.readable[account.readable]}</span>
      </div>
      <div className="mono muted">{account.homePath || '-'}</div>
      {ok ? (
        <div className="card-meta">
          <span>
            {ko.common.projects} {account.projectCount}
          </span>
          <span>
            {ko.common.sessions} {account.sessionCount}
          </span>
          <span>
            {ko.common.lastActivity} {fmtDate(account.lastActivityAt)}
          </span>
        </div>
      ) : (
        <div className="muted small">{ko.accounts.needPermission}</div>
      )}
    </>
  );
  return ok ? (
    <Link to={`/accounts/${account.id}`} className="card card-link">
      {body}
    </Link>
  ) : (
    <div className="card card-disabled">{body}</div>
  );
}
