import { Navigate, Route, Routes } from 'react-router';
import { AccountsPage } from './pages/AccountsPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { SessionPage } from './pages/SessionPage';
import { SessionsPage } from './pages/SessionsPage';
import { SourcesPage } from './pages/SourcesPage';

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<AccountsPage />} />
      <Route path="/accounts/:accountId" element={<ProjectsPage />} />
      <Route path="/sources" element={<SourcesPage />} />
      <Route path="/projects/:projectId" element={<SessionsPage />} />
      <Route path="/sessions/:sessionKey" element={<SessionPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
