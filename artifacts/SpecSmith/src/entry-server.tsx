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
import LegacyMigrationBanner from './components/LegacyMigrationBanner';
import Home from './pages/Home';
import NotFound from './pages/not-found';
import Builder from './pages/Builder';
import Prebuilts from './pages/Prebuilts';
import PrebuiltDetail from './pages/PrebuiltDetail';
import Compare from './pages/Compare';
import About from './pages/About';
import SharedBuild from './pages/SharedBuild';
import ResetPassword from './pages/ResetPassword';
import Login from './pages/Login';
import Signup from './pages/Signup';
import Matchup from './pages/Matchup';
import GpuMatchupIndex from './pages/GpuMatchupIndex';
import BestGpuForGame from './pages/BestGpuForGame';
import BestGpuIndex from './pages/BestGpuIndex';
import BestCpuForGame from './pages/BestCpuForGame';
import BestCpuIndex from './pages/BestCpuIndex';
import GpuTierList from './pages/GpuTierList';
import CpuTierList from './pages/CpuTierList';
import UpgradeCalculator from './pages/UpgradeCalculator';
import UpgradeCalculatorCpu from './pages/UpgradeCalculatorCpu';
import Gallery from './pages/Gallery';
import GpuUpgradeIndex from './pages/GpuUpgradeIndex';
import GpuUpgradePage from './pages/GpuUpgradePage';
import CpuUpgradeIndex from './pages/CpuUpgradeIndex';
import CpuUpgradePage from './pages/CpuUpgradePage';
import BestMotherboardIndex from './pages/BestMotherboardIndex';
import BestMotherboardPage from './pages/BestMotherboardPage';
import ComponentGuidePage from './pages/ComponentGuidePage';
import PartsGuidesHub from './pages/PartsGuidesHub';
import BuildCrate from './pages/BuildCrate';
import PriceGuesser from './pages/PriceGuesser';
import BudgetPartIndex from './pages/BudgetPartIndex';
import BudgetPartPage from './pages/BudgetPartPage';
import { GPU_BUDGET_TIERS, CPU_BUDGET_TIERS, getBudgetPageMeta } from './lib/budgetPages';
import UseCaseBuildIndex from './pages/UseCaseBuildIndex';
import UseCaseBuildPage from './pages/UseCaseBuildPage';
import { USE_CASES, getUseCasePageMeta } from './lib/useCaseBuilds';
import SffBuildPage from './pages/SffBuildPage';
import { getSffPageMeta } from './lib/sffBuilds';
import Quiz from './pages/Quiz';
import QuizLanding from './pages/QuizLanding';
import { QUIZ_USE_CASES, getQuizPageMeta } from './lib/quiz';
import AdminBenchmarks from './pages/AdminBenchmarks';
import { prebuilts, getPrebuiltMeta } from './lib/prebuilts';
import { MATCHUPS, CPU_MATCHUPS, getMatchupMeta, getCpuMatchupMeta } from './lib/matchups';
import { GAME_PAGES, getGamePageMeta } from './lib/gamePages';
import { CPU_GAME_PAGES, getCpuGamePageMeta } from './lib/cpuGamePages';
import { UPGRADE_PAGES, getUpgradePageMeta } from './lib/upgradePages';
import { CPU_UPGRADE_PAGES, getCpuUpgradePageMeta } from './lib/cpuUpgradePages';
import { SOCKET_PAGES, getSocketPageMeta } from './lib/motherboardPages';
import { COMPONENT_GUIDES, getComponentGuideMeta } from './lib/componentGuides';
import { getRouteMeta, type RouteMeta } from './lib/seo';

export { getRouteMeta, buildHeadTags, breadcrumbJsonLd, siteJsonLdGraph, SITE_URL, DEFAULT_OG_IMAGE } from './lib/seo';

export const PRERENDER_ROUTES = [
  '/',
  '/builder',
  '/prebuilts',
  '/compare',
  '/about',
  '/build',
  '/reset-password',
  '/login',
  '/signup',
  '/404',
  '/vs',
  '/best-gpu',
  '/best-cpu',
  '/gpu-tier-list',
  '/cpu-tier-list',
  '/upgrade-calculator',
  '/upgrade-calculator-cpu',
  '/gallery',
  '/upgrade',
  '/upgrade-cpu',
  '/best-motherboard',
  ...COMPONENT_GUIDES.map((g) => `/best-${g.slug}`),
  '/parts-guides',
  '/crate',
  '/price-guesser',
  '/best-gpu-budget',
  '/best-cpu-budget',
  ...GPU_BUDGET_TIERS.map((t) => `/best-gpu-budget/${t.slug}`),
  ...CPU_BUDGET_TIERS.map((t) => `/best-cpu-budget/${t.slug}`),
  '/best-pc-for',
  '/best-pc-for/small-form-factor',
  ...USE_CASES.map((u) => `/best-pc-for/${u.slug}`),
  ...prebuilts.map((p) => `/prebuilts/${p.id}`),
  ...MATCHUPS.map((m) => `/vs/${m.slug}`),
  ...CPU_MATCHUPS.map((m) => `/vs/${m.slug}`),
  ...GAME_PAGES.map((p) => `/best-gpu/${p.slug}`),
  ...CPU_GAME_PAGES.map((p) => `/best-cpu/${p.slug}`),
  ...UPGRADE_PAGES.map((p) => `/upgrade/${p.slug}`),
  ...CPU_UPGRADE_PAGES.map((p) => `/upgrade-cpu/${p.slug}`),
  ...SOCKET_PAGES.map((p) => `/best-motherboard/${p.slug}`),
  '/quiz',
  ...QUIZ_USE_CASES.map((u) => `/quiz/${u.slug}`),
  // '/admin/benchmarks' is deliberately NOT in this list. See the
  // SECURITY comment on its <Route> below — prerendering it would write
  // its full content to a publicly-fetchable static HTML file, which is
  // the one exposure a route-level guard on this static site can't close.
];

const DYNAMIC_META_BY_PATH: Record<string, RouteMeta> = Object.fromEntries([
  ...prebuilts.map((p) => [`/prebuilts/${p.id}`, getPrebuiltMeta(p)] as const),
  ...MATCHUPS.map((m) => [`/vs/${m.slug}`, getMatchupMeta(m)] as const),
  ...CPU_MATCHUPS.map((m) => [`/vs/${m.slug}`, getCpuMatchupMeta(m)] as const),
  ...GAME_PAGES.map((p) => [`/best-gpu/${p.slug}`, getGamePageMeta(p)] as const),
  ...CPU_GAME_PAGES.map((p) => [`/best-cpu/${p.slug}`, getCpuGamePageMeta(p)] as const),
  ...UPGRADE_PAGES.map((p) => [`/upgrade/${p.slug}`, getUpgradePageMeta(p)] as const),
  ...CPU_UPGRADE_PAGES.map((p) => [`/upgrade-cpu/${p.slug}`, getCpuUpgradePageMeta(p)] as const),
  ...SOCKET_PAGES.map((p) => [`/best-motherboard/${p.slug}`, getSocketPageMeta(p)] as const),
  ...COMPONENT_GUIDES.map((g) => [`/best-${g.slug}`, getComponentGuideMeta(g)] as const),
  ...GPU_BUDGET_TIERS.map((t) => [`/best-gpu-budget/${t.slug}`, getBudgetPageMeta('gpu', t)] as const),
  ...CPU_BUDGET_TIERS.map((t) => [`/best-cpu-budget/${t.slug}`, getBudgetPageMeta('cpu', t)] as const),
  ...USE_CASES.map((u) => [`/best-pc-for/${u.slug}`, getUseCasePageMeta(u)] as const),
  ['/best-pc-for/small-form-factor', getSffPageMeta()] as const,
  ...QUIZ_USE_CASES.map((u) => [`/quiz/${u.slug}`, getQuizPageMeta(u.slug)] as const),
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
            <LegacyMigrationBanner />
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
                <Route path="/reset-password" element={<PageWrapper><ResetPassword /></PageWrapper>} />
                <Route path="/login" element={<PageWrapper><Login /></PageWrapper>} />
                <Route path="/signup" element={<PageWrapper><Signup /></PageWrapper>} />
                <Route path="/vs" element={<PageWrapper><GpuMatchupIndex /></PageWrapper>} />
                <Route path="/vs/:slug" element={<PageWrapper><Matchup /></PageWrapper>} />
                <Route path="/best-gpu" element={<PageWrapper><BestGpuIndex /></PageWrapper>} />
                <Route path="/best-gpu/:slug" element={<PageWrapper><BestGpuForGame /></PageWrapper>} />
                <Route path="/best-cpu" element={<PageWrapper><BestCpuIndex /></PageWrapper>} />
                <Route path="/best-cpu/:slug" element={<PageWrapper><BestCpuForGame /></PageWrapper>} />
                <Route path="/gpu-tier-list" element={<PageWrapper><GpuTierList /></PageWrapper>} />
                <Route path="/cpu-tier-list" element={<PageWrapper><CpuTierList /></PageWrapper>} />
                <Route path="/upgrade-calculator" element={<PageWrapper><UpgradeCalculator /></PageWrapper>} />
                <Route path="/upgrade-calculator-cpu" element={<PageWrapper><UpgradeCalculatorCpu /></PageWrapper>} />
                <Route path="/gallery" element={<PageWrapper><Gallery /></PageWrapper>} />
                <Route path="/upgrade" element={<PageWrapper><GpuUpgradeIndex /></PageWrapper>} />
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
                <Route path="/best-monitor" element={<PageWrapper><ComponentGuidePage category="monitor" /></PageWrapper>} />
                <Route path="/best-keyboard" element={<PageWrapper><ComponentGuidePage category="keyboard" /></PageWrapper>} />
                <Route path="/best-mouse" element={<PageWrapper><ComponentGuidePage category="mouse" /></PageWrapper>} />
                <Route path="/best-headset" element={<PageWrapper><ComponentGuidePage category="headset" /></PageWrapper>} />
                <Route path="/parts-guides" element={<PageWrapper><PartsGuidesHub /></PageWrapper>} />
                <Route path="/crate" element={<PageWrapper><BuildCrate /></PageWrapper>} />
                <Route path="/price-guesser" element={<PageWrapper><PriceGuesser /></PageWrapper>} />
                <Route path="/best-gpu-budget" element={<PageWrapper><BudgetPartIndex category="gpu" /></PageWrapper>} />
                <Route path="/best-gpu-budget/:slug" element={<PageWrapper><BudgetPartPage category="gpu" /></PageWrapper>} />
                <Route path="/best-cpu-budget" element={<PageWrapper><BudgetPartIndex category="cpu" /></PageWrapper>} />
                <Route path="/best-cpu-budget/:slug" element={<PageWrapper><BudgetPartPage category="cpu" /></PageWrapper>} />
                <Route path="/best-pc-for" element={<PageWrapper><UseCaseBuildIndex /></PageWrapper>} />
                <Route path="/best-pc-for/small-form-factor" element={<PageWrapper><SffBuildPage /></PageWrapper>} />
                <Route path="/best-pc-for/:slug" element={<PageWrapper><UseCaseBuildPage /></PageWrapper>} />
                <Route path="/quiz" element={<PageWrapper><Quiz /></PageWrapper>} />
                <Route path="/quiz/:slug" element={<PageWrapper><QuizLanding /></PageWrapper>} />
                {/* Kept in the SSR route table (so `pnpm dev`/local rendering still
                    works) but deliberately absent from PRERENDER_ROUTES above — see
                    the matching SECURITY comment in App.tsx. */}
                <Route path="/admin/benchmarks" element={<PageWrapper><AdminBenchmarks /></PageWrapper>} />
                <Route path="*" element={<PageWrapper><NotFound /></PageWrapper>} />
              </Routes>
            </Suspense>
            <Footer />
          </StaticRouter>
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>,
  );
}
