import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { Routes, Route } from 'react-router-dom';
import { ThemeProvider } from './context/ThemeContext';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './context/ToastContext';
import Navbar from './components/Navbar';
import Footer from './components/Footer';
import Home from './pages/Home';
import Builder from './pages/Builder';
import Prebuilts from './pages/Prebuilts';
import PrebuiltDetail from './pages/PrebuiltDetail';
import Compare from './pages/Compare';
import About from './pages/About';
import SharedBuild from './pages/SharedBuild';
import GpuMatchup from './pages/GpuMatchup';
import GpuMatchupIndex from './pages/GpuMatchupIndex';
import { prebuilts } from './lib/prebuilts';
import { MATCHUPS } from './lib/matchups';
import { getPrebuiltMeta, getMatchupMeta, getRouteMeta, type RouteMeta } from './lib/seo';

export { getRouteMeta, buildHeadTags, SITE_URL, DEFAULT_OG_IMAGE } from './lib/seo';

export const PRERENDER_ROUTES = [
  '/',
  '/builder',
  '/prebuilts',
  '/compare',
  '/about',
  '/build',
  '/vs',
  ...prebuilts.map((p) => `/prebuilts/${p.id}`),
  ...MATCHUPS.map((m) => `/vs/${m.slug}`),
];

const DYNAMIC_META_BY_PATH: Record<string, RouteMeta> = Object.fromEntries([
  ...prebuilts.map((p) => [`/prebuilts/${p.id}`, getPrebuiltMeta(p)] as const),
  ...MATCHUPS.map((m) => [`/vs/${m.slug}`, getMatchupMeta(m)] as const),
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
            <Routes>
              <Route path="/" element={<Home />} />
              <Route path="/builder" element={<Builder />} />
              <Route path="/prebuilts" element={<Prebuilts />} />
              <Route path="/prebuilts/:slug" element={<PrebuiltDetail />} />
              <Route path="/compare" element={<Compare />} />
              <Route path="/about" element={<About />} />
              <Route path="/build" element={<SharedBuild />} />
              <Route path="/vs" element={<GpuMatchupIndex />} />
              <Route path="/vs/:slug" element={<GpuMatchup />} />
            </Routes>
            <Footer />
          </StaticRouter>
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>,
  );
}
