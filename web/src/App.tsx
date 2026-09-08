import { AuthProvider, useAuth } from './context/AuthContext';
import { Layout } from './components/Layout';
import { Loading } from './components/Notice';
import { LoginPage } from './pages/LoginPage';
import { AppRoutes } from './routes';

function Gate() {
  const { me, loading, error } = useAuth();
  if (loading) return <Loading />;
  if (!me) return <div className="notice notice-error">서버에 연결하지 못했습니다{error ? `: ${error}` : ''}</div>;
  if (me.mode === 'home-token' && !me.authenticated) return <LoginPage />;
  return (
    <Layout>
      <AppRoutes />
    </Layout>
  );
}

export function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
