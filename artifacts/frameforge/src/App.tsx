import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import Home from './pages/Home';
import Builder from './pages/Builder';
import Prebuilts from './pages/Prebuilts';
import Compare from './pages/Compare';
import About from './pages/About';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import SharedBuild from './pages/SharedBuild';

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
      <Routes>
        <Route path="/"          element={<PageWrapper><Home /></PageWrapper>} />
        <Route path="/builder"   element={<PageWrapper><Builder /></PageWrapper>} />
        <Route path="/prebuilts" element={<PageWrapper><Prebuilts /></PageWrapper>} />
        <Route path="/compare"   element={<PageWrapper><Compare /></PageWrapper>} />
        <Route path="/about"     element={<PageWrapper><About /></PageWrapper>} />
        <Route path="/login"     element={<PageWrapper><Login /></PageWrapper>} />
        <Route path="/signup"    element={<PageWrapper><Signup /></PageWrapper>} />
        <Route path="/dashboard" element={<PageWrapper><Dashboard /></PageWrapper>} />
        <Route path="/settings"  element={<PageWrapper><Settings /></PageWrapper>} />
        <Route path="/build"     element={<PageWrapper><SharedBuild /></PageWrapper>} />
      </Routes>
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
