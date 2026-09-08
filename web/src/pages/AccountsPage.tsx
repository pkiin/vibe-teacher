import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import type { Account } from '@vibe-teacher/shared';
import { AccountCard } from '../components/AccountCard';
import { Breadcrumb } from '../components/Layout';
import { ErrorBox, Loading, Notice } from '../components/Notice';
import { useApi } from '../hooks/useApi';
import { ko } from '../i18n/ko';

export function AccountsPage() {
  const { data, error, loading, reload } = useApi<Account[]>('/api/accounts');
  const navigate = useNavigate();
  const readable = (data ?? []).filter((a) => a.readable === 'ok');

  useEffect(() => {
    if (data && data.length === 1 && readable.length === 1 && readable[0]) navigate(`/accounts/${readable[0].id}`, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  return (
    <div className="page">
      <Breadcrumb items={[{ label: ko.accounts.title }]} />
      <h1>{ko.accounts.title}</h1>
      <p className="muted">{ko.accounts.subtitle}</p>
      {loading && <Loading />}
      {error && <ErrorBox error={error} onRetry={reload} />}
      {data && readable.length === 0 && <Notice kind="warn">{ko.accounts.empty}</Notice>}
      <div className="card-grid">{data?.map((a) => <AccountCard key={a.id} account={a} />)}</div>
    </div>
  );
}
