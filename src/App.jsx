import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';

// Pages
import Login from './pages/Login';
import AdminLogin from './pages/AdminLogin';
import Dashboard from './pages/Dashboard';

// Imports
import Profile from './pages/Profile';
import Portfolio from './pages/Portfolio';
import Experience from './pages/Experience';
import CourseMaterials from './pages/CourseMaterials';
import Community from './pages/Community';
import BFIAA from './pages/BFIAA';
import Inbox from './pages/Inbox';
import Settings from './pages/Settings';
import Directory from './pages/Directory';
import StudentManager from './pages/admin/StudentManager';
import CertificateDesigner from './pages/admin/CertificateDesigner';
import AnnouncementsManager from './pages/admin/AnnouncementsManager';
import CourseMaterialsManager from './pages/admin/CourseMaterialsManager';
import Certificates from './pages/Certificates';
import Sidebar from './components/Sidebar';

// Protected Route Wrapper
const ProtectedRoute = ({ children, requiredRole }) => {
  const { currentUser, loading } = useAuth();

  if (loading) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center' }}>
        <div className="loader-spinner"></div>
      </div>
    );
  }

  if (!currentUser) {
    return <Navigate to="/login" />;
  }

  if (requiredRole && !requiredRole.includes(currentUser.role)) {
    return <Navigate to="/" />;
  }

  return children;
};

// Layout component to wrap protected routes
const Layout = ({ children }) => {
  return (
    <div style={{ display: 'flex' }}>
      <Sidebar />
      <main className="main-content">
        {children}
      </main>
    </div>
  )
}

function App() {
  return (
    <ThemeProvider>
      <Router>
        <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/admin/login" element={<AdminLogin />} />
          
          <Route path="/" element={
            <ProtectedRoute>
              <Layout>
                <Dashboard />
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

          <Route path="/profile" element={
            <ProtectedRoute>
              <Layout>
                <Profile />
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
            <ProtectedRoute>
              <Layout>
                <Certificates />
              </Layout>
            </ProtectedRoute>
          } />

          <Route path="/courses" element={
            <ProtectedRoute>
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
          <Route path="/settings" element={
            <ProtectedRoute>
              <Layout>
                <Settings />
              </Layout>
            </ProtectedRoute>
          } />
          <Route path="/admin/students" element={
            <ProtectedRoute requiredRole={['admin']}>
              <Layout>
                <StudentManager />
              </Layout>
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
    </ThemeProvider>
  );
}

export default App;
