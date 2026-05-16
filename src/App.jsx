import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import { CallProvider } from './context/CallContext';
import { Film, Aperture } from 'lucide-react';

// Pages
import Login from './pages/Login';
import ForgotPassword from './pages/ForgotPassword';
import ResetPassword from './pages/ResetPassword';
import AdminLogin from './pages/AdminLogin';
import AdminForgotPassword from './pages/AdminForgotPassword';
import AdminResetPassword from './pages/AdminResetPassword';
import Dashboard from './pages/Dashboard';
import NoticeBoard from './pages/NoticeBoard';

// Imports
import Profile from './pages/Profile';
import PublicProfile from './pages/PublicProfile';
import Portfolio from './pages/Portfolio';
import Experience from './pages/Experience';
import CourseMaterials from './pages/CourseMaterials';
import Community from './pages/Community';
import BFIAA from './pages/BFIAA';
import Inbox from './pages/Inbox';
import Classroom from './pages/Classroom';
import Settings from './pages/Settings';
import Directory from './pages/Directory';
import Registry from './pages/Registry';
import InstructorDirectory from './pages/InstructorDirectory';
import StudentManager from './pages/admin/StudentManager';
import TeacherManager from './pages/admin/TeacherManager';
import CertificateDesigner from './pages/admin/CertificateDesigner';
import AnnouncementsManager from './pages/admin/AnnouncementsManager';
import CourseMaterialsManager from './pages/admin/CourseMaterialsManager';
import Certificates from './pages/Certificates';
import Sidebar from './components/Sidebar';
import ErrorBoundary from './components/ErrorBoundary';
import SkeletonLoader from './components/SkeletonLoader';
import { IncomingCallAlert, ActiveCallScreen } from './components/CallComponents';

// Protected Route Wrapper
const ProtectedRoute = ({ children, requiredRole }) => {
  const { currentUser, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}>
        <SkeletonLoader variant="dashboard" />
      </div>
    );
  }

  if (!currentUser) {
    return <Navigate to="/login" replace />;
  }

  if (requiredRole && !requiredRole.includes(currentUser.role)) {
    return <Navigate to="/" replace />;
  }

  return children;
};

// Redirect authenticated users away from login pages
const LoginRoute = ({ children }) => {
  const { currentUser, loading } = useAuth();
  if (loading) return null;
  if (currentUser) return <Navigate to="/" replace />;
  return children;
};

// Layout component to wrap protected routes
const Layout = ({ children }) => {
  const mainRef = React.useRef(null);
  const location = useLocation();
  const hideHeader = location.pathname.startsWith('/inbox');

  return (
    <CallProvider>
      <div style={{ display: 'flex', position: 'relative', minHeight: '100vh' }}>
        
        {/* Global Cinematic Watermarks */}
        <div style={{ position: 'fixed', top: '10%', right: '-5%', opacity: 0.02, transform: 'rotate(15deg)', pointerEvents: 'none', zIndex: 0, color: 'var(--text-primary)' }}>
          <Film size={400} strokeWidth={1} />
        </div>
        <div style={{ position: 'fixed', bottom: '-10%', left: '15%', opacity: 0.015, transform: 'rotate(-10deg)', pointerEvents: 'none', zIndex: 0, color: 'var(--accent-primary)' }}>
          <Aperture size={350} strokeWidth={1} />
        </div>

        <Sidebar />
        <main ref={mainRef} className="main-content" style={{ position: 'relative', zIndex: 1 }}>
          {/* Desktop Institutional Header */}
          {!hideHeader && (
          <div className="desktop-only-header" style={{
            position: 'fixed',
            top: 0,
            left: '280px',
            right: 0,
            zIndex: 50,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'stretch',
          }}>
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '16px',
              padding: '14px 2rem',
              background: 'var(--bg-secondary)',
              borderBottom: '1px solid var(--glass-border)',
            }}>
              <img src={`${import.meta.env.BASE_URL}bfi-logo.jpg`} alt="Logo" style={{ height: '28px', borderRadius: '6px' }} />
              <div style={{
                width: '1px',
                height: '20px',
                background: 'var(--glass-border)',
              }} />
              <div style={{
                fontFamily: '"Li Ador Noirrit", sans-serif',
                fontSize: '1.3rem',
                letterSpacing: '0.06em',
                color: 'var(--text-primary)',
                fontWeight: 700,
              }}>
                Bangladesh Film Institute
              </div>
            </div>
          </div>
          )}
          {children}
        </main>
        <IncomingCallAlert />
        <ActiveCallScreen />
      </div>
    </CallProvider>
  );
};


const ScrollToTop = () => {
  const location = useLocation();
  React.useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);
  return null;
};

function App() {
  const routerBase = (import.meta.env.BASE_URL || '/').replace(/\/+$/, '') || '/';

  return (
    <ThemeProvider>
      <ErrorBoundary>
        <Router basename={routerBase}>
          <ScrollToTop />
          <AuthProvider>

          <Routes>
          <Route path="/login" element={<LoginRoute><Login /></LoginRoute>} />
          <Route path="/forgot-password" element={<LoginRoute><ForgotPassword /></LoginRoute>} />
          <Route path="/reset-password/:id/:token" element={<LoginRoute><ResetPassword /></LoginRoute>} />
          <Route path="/admin/login" element={<LoginRoute><AdminLogin /></LoginRoute>} />
          <Route path="/admin/forgot-password" element={<LoginRoute><AdminForgotPassword /></LoginRoute>} />
          <Route path="/admin/reset-password/:id/:token" element={<LoginRoute><AdminResetPassword /></LoginRoute>} />
          
          <Route path="/" element={
            <ProtectedRoute>
              <Layout>
                <Dashboard />
              </Layout>
            </ProtectedRoute>
          } />

          <Route path="/notices" element={
            <ProtectedRoute>
              <Layout>
                <NoticeBoard />
              </Layout>
            </ProtectedRoute>
          } />

          <Route path="/inbox" element={
            <ProtectedRoute>
              <Layout>
                <Inbox />
              </Layout>
            </ProtectedRoute>
          } />

          <Route path="/classroom" element={
            <ProtectedRoute>
              <Layout>
                <Classroom />
              </Layout>
            </ProtectedRoute>
          } />

          <Route path="/profile" element={
            <ProtectedRoute>
              <Layout>
                <Profile />
              </Layout>
            </ProtectedRoute>
          } />

          <Route path="/profile/:id" element={
            <ProtectedRoute>
              <Layout>
                <PublicProfile />
              </Layout>
            </ProtectedRoute>
          } />

          <Route path="/portfolio" element={
            <ProtectedRoute>
              <Layout>
                <Portfolio />
              </Layout>
            </ProtectedRoute>
          } />
          <Route path="/experience" element={
            <ProtectedRoute>
              <Layout>
                <Experience />
              </Layout>
            </ProtectedRoute>
          } />

          <Route path="/certificates" element={
            <ProtectedRoute requiredRole={['student']}>
              <Layout>
                <Certificates />
              </Layout>
            </ProtectedRoute>
          } />

          <Route path="/courses" element={
            <ProtectedRoute requiredRole={['student', 'instructor']}>
              <Layout>
                <CourseMaterials />
              </Layout>
            </ProtectedRoute>
          } />

          <Route path="/community" element={
            <ProtectedRoute>
              <Layout>
                <Community />
              </Layout>
            </ProtectedRoute>
          } />



          <Route path="/bfiaa" element={
            <ProtectedRoute>
              <Layout>
                <BFIAA />
              </Layout>
            </ProtectedRoute>
          } />
          <Route path="/directory" element={
            <ProtectedRoute>
              <Layout>
                <Directory />
              </Layout>
            </ProtectedRoute>
          } />
          <Route path="/registry" element={
            <ProtectedRoute>
              <Layout>
                <Registry />
              </Layout>
            </ProtectedRoute>
          } />
          <Route path="/instructors" element={
            <ProtectedRoute>
              <Layout>
                <InstructorDirectory />
              </Layout>
            </ProtectedRoute>
          } />
          <Route path="/settings" element={
            <ProtectedRoute>
              <Layout>
                <Settings />
              </Layout>
            </ProtectedRoute>
          } />
          <Route path="/admin/students" element={
            <ProtectedRoute requiredRole={['admin']}>
              <Layout><StudentManager /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/admin/teachers" element={
            <ProtectedRoute requiredRole={['admin']}>
              <Layout><TeacherManager /></Layout>
            </ProtectedRoute>
          } />
          <Route path="/admin/certificate-designer" element={
            <ProtectedRoute requiredRole={['admin']}>
              <Layout>
                <CertificateDesigner />
              </Layout>
            </ProtectedRoute>
          } />
          <Route path="/admin/announcements" element={
            <ProtectedRoute requiredRole={['admin']}>
              <Layout>
                <AnnouncementsManager />
              </Layout>
            </ProtectedRoute>
          } />
          <Route path="/admin/course-materials" element={
            <ProtectedRoute requiredRole={['admin']}>
              <Layout>
                <CourseMaterialsManager />
              </Layout>
            </ProtectedRoute>
          } />

          {/* Catch all */}
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
        </AuthProvider>
        </Router>
      </ErrorBoundary>
    </ThemeProvider>
  );
}

export default App;
