import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
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
import { prebuilts } from './lib/prebuilts';
import { getPrebuiltMeta, getRouteMeta, type RouteMeta } from './lib/seo';

export { getRouteMeta, buildHeadTags, SITE_URL, DEFAULT_OG_IMAGE } from './lib/seo';

const PAGES: Record<string, React.ComponentType> = {
  '/': Home,
  '/builder': Builder,
  '/prebuilts': Prebuilts,
  '/compare': Compare,
  '/about': About,
  '/build': SharedBuild,
};

for (const p of prebuilts) {
  PAGES[`/prebuilts/${p.id}`] = PrebuiltDetail;
}

export const PRERENDER_ROUTES = Object.keys(PAGES);

const PREBUILT_META_BY_PATH: Record<string, RouteMeta> = Object.fromEntries(
  prebuilts.map((p) => [`/prebuilts/${p.id}`, getPrebuiltMeta(p)]),
);

export function getPrerenderMeta(path: string): RouteMeta {
  if (PREBUILT_META_BY_PATH[path]) return PREBUILT_META_BY_PATH[path];
  // Falls back to the static ROUTE_META table for non-dynamic routes.
  return getRouteMeta(path);
}

export function render(url: string): string {
  const Page = PAGES[url];
  if (!Page) {
    throw new Error(`No prerenderable page registered for route "${url}"`);
  }

  return renderToString(
    <ThemeProvider>
      <AuthProvider>
        <ToastProvider>
          <StaticRouter location={url}>
            <Navbar />
            <Page />
            <Footer />
          </StaticRouter>
        </ToastProvider>
      </AuthProvider>
    </ThemeProvider>,
  );
}
