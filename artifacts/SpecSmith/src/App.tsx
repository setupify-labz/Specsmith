import { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import PageWrapper from './components/PageWrapper';

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
const Matchup = lazy(() => import('./pages/Matchup'));
const GpuMatchupIndex = lazy(() => import('./pages/GpuMatchupIndex'));
const BestGpuForGame = lazy(() => import('./pages/BestGpuForGame'));
const BestGpuIndex = lazy(() => import('./pages/BestGpuIndex'));
const BestCpuForGame = lazy(() => import('./pages/BestCpuForGame'));
const BestCpuIndex = lazy(() => import('./pages/BestCpuIndex'));
const GpuTierList = lazy(() => import('./pages/GpuTierList'));
const UpgradeCalculator = lazy(() => import('./pages/UpgradeCalculator'));
const Gallery = lazy(() => import('./pages/Gallery'));
const GpuUpgradeIndex = lazy(() => import('./pages/GpuUpgradeIndex'));
const GpuUpgradePage = lazy(() => import('./pages/GpuUpgradePage'));
const CpuUpgradeIndex = lazy(() => import('./pages/CpuUpgradeIndex'));
const CpuUpgradePage = lazy(() => import('./pages/CpuUpgradePage'));
const BestMotherboardIndex = lazy(() => import('./pages/BestMotherboardIndex'));
const BestMotherboardPage = lazy(() => import('./pages/BestMotherboardPage'));
const ComponentGuidePage = lazy(() => import('./pages/ComponentGuidePage'));
const BuildCrate = lazy(() => import('./pages/BuildCrate'));

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
          <Route path="/vs/:slug"  element={<PageWrapper><Matchup /></PageWrapper>} />
          <Route path="/best-gpu"  element={<PageWrapper><BestGpuIndex /></PageWrapper>} />
          <Route path="/best-gpu/:slug" element={<PageWrapper><BestGpuForGame /></PageWrapper>} />
          <Route path="/best-cpu"  element={<PageWrapper><BestCpuIndex /></PageWrapper>} />
          <Route path="/best-cpu/:slug" element={<PageWrapper><BestCpuForGame /></PageWrapper>} />
          <Route path="/gpu-tier-list" element={<PageWrapper><GpuTierList /></PageWrapper>} />
          <Route path="/upgrade-calculator" element={<PageWrapper><UpgradeCalculator /></PageWrapper>} />
          <Route path="/gallery"   element={<PageWrapper><Gallery /></PageWrapper>} />
          <Route path="/upgrade"   element={<PageWrapper><GpuUpgradeIndex /></PageWrapper>} />
          <Route path="/upgrade/:slug" element={<PageWrapper><GpuUpgradePage /></PageWrapper>} />
          <Route path="/upgrade-cpu" element={<PageWrapper><CpuUpgradeIndex /></PageWrapper>} />
          <Route path="/upgrade-cpu/:slug" element={<PageWrapper><CpuUpgradePage /></PageWrapper>} />
          <Route path="/best-motherboard" element={<PageWrapper><BestMotherboardIndex /></PageWrapper>} />
          <Route path="/best-motherboard/:slug" element={<PageWrapper><BestMotherboardPage /></PageWrapper>} />
          <Route path="/best-ram" element={<PageWrapper><ComponentGuidePage category="ram" /></PageWrapper>} />
          <Route path="/best-storage" element={<PageWrapper><ComponentGuidePage category="storage" /></PageWrapper>} />
          <Route path="/best-psu" element={<PageWrapper><ComponentGuidePage category="psu" /></PageWrapper>} />
          <Route path="/best-case" element={<PageWrapper><ComponentGuidePage category="case" /></PageWrapper>} />
          <Route path="/best-cooler" element={<PageWrapper><ComponentGuidePage category="cooler" /></PageWrapper>} />
          <Route path="/crate"     element={<PageWrapper><BuildCrate /></PageWrapper>} />
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
