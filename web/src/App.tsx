import { AuthProvider, useAuth } from './context/AuthContext';
import { Layout } from './components/Layout';
import { Loading } from './components/Notice';
import { LoginPage } from './pages/LoginPage';
import { DisplayProvider } from './context/DisplayContext';
import { AppRoutes } from './routes';
import { EmailConfirmationFlow } from './pages/EmailConfirmationPage';
import type { EmailConfirmationResult } from './auth/email-confirmation';

function Gate() {
  const { me, loading, error } = useAuth();
  if (loading) return <Loading />;
  if (!me) return <div className="notice notice-error">서버에 연결하지 못했습니다{error ? `: ${error}` : ''}</div>;
  if (me.mode !== 'none' && !me.authenticated) return <LoginPage />;
  return (
    <Layout key={me.username ?? me.mode}>
      <AppRoutes />
    </Layout>
  );
}

export function App({ emailConfirmation }: { emailConfirmation?: Promise<EmailConfirmationResult> | null }) {
  return (
    <DisplayProvider>
      {emailConfirmation ? <EmailConfirmationFlow result={emailConfirmation} /> : <AuthProvider><Gate /></AuthProvider>}
    </DisplayProvider>
  );
}
