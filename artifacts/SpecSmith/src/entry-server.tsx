import { Suspense } from 'react';
import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import PageWrapper from './components/PageWrapper';
import Home from './pages/Home';
import Builder from './pages/Builder';
import Prebuilts from './pages/Prebuilts';
import PrebuiltDetail from './pages/PrebuiltDetail';
import Compare from './pages/Compare';
import About from './pages/About';
import SharedBuild from './pages/SharedBuild';
import Matchup from './pages/Matchup';
import GpuMatchupIndex from './pages/GpuMatchupIndex';
import BestGpuForGame from './pages/BestGpuForGame';
import BestGpuIndex from './pages/BestGpuIndex';
import BestCpuForGame from './pages/BestCpuForGame';
import BestCpuIndex from './pages/BestCpuIndex';
import GpuTierList from './pages/GpuTierList';
import UpgradeCalculator from './pages/UpgradeCalculator';
import Gallery from './pages/Gallery';
import GpuUpgradeIndex from './pages/GpuUpgradeIndex';
import GpuUpgradePage from './pages/GpuUpgradePage';
import CpuUpgradeIndex from './pages/CpuUpgradeIndex';
import CpuUpgradePage from './pages/CpuUpgradePage';
import BuildCrate from './pages/BuildCrate';
import { prebuilts, getPrebuiltMeta } from './lib/prebuilts';
import { MATCHUPS, CPU_MATCHUPS, getMatchupMeta, getCpuMatchupMeta } from './lib/matchups';
import { GAME_PAGES, getGamePageMeta } from './lib/gamePages';
import { CPU_GAME_PAGES, getCpuGamePageMeta } from './lib/cpuGamePages';
import { UPGRADE_PAGES, getUpgradePageMeta } from './lib/upgradePages';
import { CPU_UPGRADE_PAGES, getCpuUpgradePageMeta } from './lib/cpuUpgradePages';
import { getRouteMeta, type RouteMeta } from './lib/seo';

export { getRouteMeta, buildHeadTags, SITE_URL, DEFAULT_OG_IMAGE } from './lib/seo';

export const PRERENDER_ROUTES = [
  '/',
  '/builder',
  '/prebuilts',
  '/compare',
  '/about',
  '/build',
  '/vs',
  '/best-gpu',
  '/best-cpu',
  '/gpu-tier-list',
  '/upgrade-calculator',
  '/gallery',
  '/upgrade',
  '/upgrade-cpu',
  '/crate',
  ...prebuilts.map((p) => `/prebuilts/${p.id}`),
  ...MATCHUPS.map((m) => `/vs/${m.slug}`),
  ...CPU_MATCHUPS.map((m) => `/vs/${m.slug}`),
  ...GAME_PAGES.map((p) => `/best-gpu/${p.slug}`),
  ...CPU_GAME_PAGES.map((p) => `/best-cpu/${p.slug}`),
  ...UPGRADE_PAGES.map((p) => `/upgrade/${p.slug}`),
  ...CPU_UPGRADE_PAGES.map((p) => `/upgrade-cpu/${p.slug}`),
];

const DYNAMIC_META_BY_PATH: Record<string, RouteMeta> = Object.fromEntries([
  ...prebuilts.map((p) => [`/prebuilts/${p.id}`, getPrebuiltMeta(p)] as const),
  ...MATCHUPS.map((m) => [`/vs/${m.slug}`, getMatchupMeta(m)] as const),
  ...CPU_MATCHUPS.map((m) => [`/vs/${m.slug}`, getCpuMatchupMeta(m)] as const),
  ...GAME_PAGES.map((p) => [`/best-gpu/${p.slug}`, getGamePageMeta(p)] as const),
  ...CPU_GAME_PAGES.map((p) => [`/best-cpu/${p.slug}`, getCpuGamePageMeta(p)] as const),
  ...UPGRADE_PAGES.map((p) => [`/upgrade/${p.slug}`, getUpgradePageMeta(p)] as const),
  ...CPU_UPGRADE_PAGES.map((p) => [`/upgrade-cpu/${p.slug}`, getCpuUpgradePageMeta(p)] as const),
]);

export function getPrerenderMeta(path: string): RouteMeta {
  if (DYNAMIC_META_BY_PATH[path]) return DYNAMIC_META_BY_PATH[path];
  // Falls back to the static ROUTE_META table for non-dynamic routes.
  return getRouteMeta(path);
}

export function render(url: string): string {
  if (!PRERENDER_ROUTES.includes(url)) {
    throw new Error(`No prerenderable page registered for route "${url}"`);
  }

  // Real <Routes> matching (not a bare component render) so that pages
  // using useParams — /prebuilts/:slug, /vs/:slug — receive their params
  // during prerender instead of rendering their not-found fallback.
  return renderToString(
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <StaticRouter location={url}>
            <Navbar />
            {/* Mirrors the <Suspense> App.tsx wraps its (lazy-loaded) <Routes>
                in — without it, the client's Suspense boundary has no
                matching hydration markers in the static HTML, which React
                reports as a hydration mismatch (error #418) on every route. */}
            <Suspense fallback={null}>
              <Routes>
                <Route path="/" element={<PageWrapper><Home /></PageWrapper>} />
                <Route path="/builder" element={<PageWrapper><Builder /></PageWrapper>} />
                <Route path="/prebuilts" element={<PageWrapper><Prebuilts /></PageWrapper>} />
                <Route path="/prebuilts/:slug" element={<PageWrapper><PrebuiltDetail /></PageWrapper>} />
                <Route path="/compare" element={<PageWrapper><Compare /></PageWrapper>} />
                <Route path="/about" element={<PageWrapper><About /></PageWrapper>} />
                <Route path="/build" element={<PageWrapper><SharedBuild /></PageWrapper>} />
                <Route path="/vs" element={<PageWrapper><GpuMatchupIndex /></PageWrapper>} />
                <Route path="/vs/:slug" element={<PageWrapper><Matchup /></PageWrapper>} />
                <Route path="/best-gpu" element={<PageWrapper><BestGpuIndex /></PageWrapper>} />
                <Route path="/best-gpu/:slug" element={<PageWrapper><BestGpuForGame /></PageWrapper>} />
                <Route path="/best-cpu" element={<PageWrapper><BestCpuIndex /></PageWrapper>} />
                <Route path="/best-cpu/:slug" element={<PageWrapper><BestCpuForGame /></PageWrapper>} />
                <Route path="/gpu-tier-list" element={<PageWrapper><GpuTierList /></PageWrapper>} />
                <Route path="/upgrade-calculator" element={<PageWrapper><UpgradeCalculator /></PageWrapper>} />
                <Route path="/gallery" element={<PageWrapper><Gallery /></PageWrapper>} />
                <Route path="/upgrade" element={<PageWrapper><GpuUpgradeIndex /></PageWrapper>} />
                <Route path="/upgrade/:slug" element={<PageWrapper><GpuUpgradePage /></PageWrapper>} />
                <Route path="/upgrade-cpu" element={<PageWrapper><CpuUpgradeIndex /></PageWrapper>} />
                <Route path="/upgrade-cpu/:slug" element={<PageWrapper><CpuUpgradePage /></PageWrapper>} />
                <Route path="/crate" element={<PageWrapper><BuildCrate /></PageWrapper>} />
              </Routes>
            </Suspense>
            <Footer />
          </StaticRouter>
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>,
  );
}
