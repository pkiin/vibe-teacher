import { useState } from 'react';
import type { Account, Member } from '@vibe-teacher/shared';
import { apiPut } from '../api/client';
import { ErrorBox, Loading } from '../components/Notice';
import { useAuth } from '../context/AuthContext';
import { useApi } from '../hooks/useApi';
import { ko } from '../i18n/ko';

export function MembersPage() {
  const { me } = useAuth();
  if (me?.mode !== 'supabase' || !me.isAdmin) return <p className="notice">{ko.members.forbidden}</p>;
  return <Members />;
}

function Members() {
  const members = useApi<Member[]>('/api/members');
  const accounts = useApi<Account[]>('/api/members/accounts');
  return <div className="page"><h1>{ko.members.title}</h1><p className="muted">{ko.members.subtitle}</p>
    {members.loading && <Loading />}{members.error && <ErrorBox error={members.error} onRetry={members.reload} />}
    {accounts.error && <ErrorBox error={accounts.error} onRetry={accounts.reload} />}
    <div className="member-grid">{members.data?.map((member) => <MemberCard key={`${member.user_id}:${member.approved}:${member.account_ids.join(',')}`} member={member} accounts={accounts.data ?? []} onSaved={members.reload} />)}</div>
  </div>;
}

function MemberCard({ member, accounts, onSaved }: { member: Member; accounts: Account[]; onSaved: () => void }) {
  const [approved, setApproved] = useState(member.approved);
  const [ids, setIds] = useState(member.account_ids);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    setBusy(true); setError('');
    try { await apiPut('/api/members', { userId: member.user_id, approved, accountIds: ids }); onSaved(); }
    catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  return <section className="card form-grid">
    <h2 className="member-email">{member.email}</h2>
    {member.is_admin && <span className="pill pill-blue">{ko.login.admin}</span>}
    <label><input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} /> {ko.members.approve}</label>
    <fieldset><legend>{ko.members.accounts}</legend>
      {!accounts.length && <p className="muted small">{ko.members.noAccounts}</p>}
      {accounts.map((a) => <label className="member-account" key={a.id}><input type="checkbox" checked={ids.includes(a.id)} onChange={(e) => setIds(e.target.checked ? [...ids, a.id] : ids.filter((id) => id !== a.id))} />{a.username} <span className="muted small">{a.homePath}</span></label>)}
    </fieldset>
    {error && <p role="alert" className="notice notice-error">{error}</p>}
    <button className="btn btn-primary" disabled={busy} onClick={() => void save()}>{busy ? ko.common.loading : ko.members.save}</button>
  </section>;
}
