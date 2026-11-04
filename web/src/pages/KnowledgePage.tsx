import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { KnowledgeWikiResponse } from '@vibe-teacher/shared';
import { KnowledgeList } from '../components/KnowledgeList';
import { Breadcrumb } from '../components/Layout';
import { ko } from '../i18n/ko';
import { MemoryPanel } from '../components/MemoryPanel';

/** 사용자 지식 위키: 내 모든 세션에서 나온 개념과 그 확인 상태 */
export function KnowledgePage() {
  const [params, setParams] = useSearchParams();
  const projectId = params.get('projectId') ?? '';
  const [projects, setProjects] = useState<KnowledgeWikiResponse['projects']>([]);
  return (
    <div className="page">
      <Breadcrumb items={[{ label: ko.knowledge.title }]} />
      <h1>{ko.knowledge.title}</h1>
      <p className="muted">{ko.knowledge.subtitle}</p>
      {projects.length > 1 && (
        <label className="small">
          {ko.common.projects}{' '}
          <select value={projectId} onChange={(e) => setParams(e.target.value ? { projectId: e.target.value } : {})}>
            <option value="">{ko.knowledge.allProjects}</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {projects.length > 0 && <nav className="card small" aria-label={ko.analysis.projectLink}>
        <strong>{ko.analysis.projectLink}</strong>
        <ul>{projects.filter((p) => !projectId || p.id === projectId).map((p) => <li key={p.id}><Link to={`/projects/${p.id}?tab=wiki`}>{p.name}</Link></li>)}</ul>
      </nav>}
      <KnowledgeList projectId={projectId || undefined} onProjects={setProjects} />
      <MemoryPanel projectId={projectId || undefined} />
    </div>
  );
}
