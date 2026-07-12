import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import Navbar from './components/Navbar';
import Footer from './components/Footer';

const Home = lazy(() => import('./pages/Home'));
const Builder = lazy(() => import('./pages/Builder'));
const Prebuilts = lazy(() => import('./pages/Prebuilts'));
const PrebuiltDetail = lazy(() => import('./pages/PrebuiltDetail'));
const Compare = lazy(() => import('./pages/Compare'));
const About = lazy(() => import('./pages/About'));
const Login = lazy(() => import('./pages/Login'));
const Signup = lazy(() => import('./pages/Signup'));
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Settings = lazy(() => import('./pages/Settings'));
const SharedBuild = lazy(() => import('./pages/SharedBuild'));
const NotFound = lazy(() => import('./pages/not-found'));
const GpuMatchup = lazy(() => import('./pages/GpuMatchup'));
const GpuMatchupIndex = lazy(() => import('./pages/GpuMatchupIndex'));

function PageWrapper({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={location.pathname}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

function AppRoutes() {
  return (
    <>
      <Navbar />
      <Suspense fallback={null}>
        <Routes>
          <Route path="/"          element={<PageWrapper><Home /></PageWrapper>} />
          <Route path="/builder"   element={<PageWrapper><Builder /></PageWrapper>} />
          <Route path="/prebuilts" element={<PageWrapper><Prebuilts /></PageWrapper>} />
          <Route path="/prebuilts/:slug" element={<PageWrapper><PrebuiltDetail /></PageWrapper>} />
          <Route path="/compare"   element={<PageWrapper><Compare /></PageWrapper>} />
          <Route path="/about"     element={<PageWrapper><About /></PageWrapper>} />
          <Route path="/login"     element={<PageWrapper><Login /></PageWrapper>} />
          <Route path="/signup"    element={<PageWrapper><Signup /></PageWrapper>} />
          <Route path="/dashboard" element={<PageWrapper><Dashboard /></PageWrapper>} />
          <Route path="/settings"  element={<PageWrapper><Settings /></PageWrapper>} />
          <Route path="/build"     element={<PageWrapper><SharedBuild /></PageWrapper>} />
          <Route path="/vs"        element={<PageWrapper><GpuMatchupIndex /></PageWrapper>} />
          <Route path="/vs/:slug"  element={<PageWrapper><GpuMatchup /></PageWrapper>} />
          <Route path="*"          element={<PageWrapper><NotFound /></PageWrapper>} />
        </Routes>
      </Suspense>
      <Footer />
    </>
  );
}

function App() {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return (
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <BrowserRouter basename={base} future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
            <AppRoutes />
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
