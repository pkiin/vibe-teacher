import { useState } from 'react';
import type { KnowledgeWikiResponse } from '@vibe-teacher/shared';
import { KnowledgeList } from '../components/KnowledgeList';
import { Breadcrumb } from '../components/Layout';
import { useApi } from '../hooks/useApi';
import { ko } from '../i18n/ko';

/** 사용자 지식 위키: 내 모든 세션에서 나온 개념과 그 확인 상태 */
export function KnowledgePage() {
  const [projectId, setProjectId] = useState('');
  const meta = useApi<KnowledgeWikiResponse>('/api/me/knowledge');
  return (
    <div className="page">
      <Breadcrumb items={[{ label: ko.knowledge.title }]} />
      <h1>{ko.knowledge.title}</h1>
      <p className="muted">{ko.knowledge.subtitle}</p>
      {meta.data && meta.data.projects.length > 1 && (
        <label className="small">
          {ko.common.projects}{' '}
          <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">{ko.knowledge.allProjects}</option>
            {meta.data.projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <KnowledgeList projectId={projectId || undefined} />
    </div>
  );
}
