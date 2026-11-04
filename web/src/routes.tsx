import { Navigate, Route, Routes } from 'react-router';
import { AccountsPage } from './pages/AccountsPage';
import { FeaturePage } from './pages/FeaturePage';
import { KnowledgePage } from './pages/KnowledgePage';
import { ProjectsPage } from './pages/ProjectsPage';
import { SessionPage } from './pages/SessionPage';
import { SessionsPage } from './pages/SessionsPage';
import { SourcesPage } from './pages/SourcesPage';
import { StartPage } from './pages/StartPage';
import { MembersPage } from './pages/MembersPage';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<StartPage />} />
      <Route path="/accounts" element={<AccountsPage />} />
      <Route path="/members" element={<MembersPage />} />
      <Route path="/accounts/:accountId" element={<ProjectsPage />} />
      <Route path="/sources" element={<SourcesPage />} />
      <Route path="/knowledge" element={<KnowledgePage />} />
      <Route path="/projects/:projectId" element={<SessionsPage />} />
      <Route path="/projects/:projectId/features/:featureId" element={<FeaturePage />} />
      <Route path="/sessions/:sessionKey" element={<SessionPage />} />
      <Route path="/sessions/:sessionKey/analysis" element={<SessionPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
