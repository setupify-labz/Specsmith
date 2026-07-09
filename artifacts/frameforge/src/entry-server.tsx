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
import Compare from './pages/Compare';
import About from './pages/About';
import SharedBuild from './pages/SharedBuild';

export { getRouteMeta, buildHeadTags } from './lib/seo';

const PAGES: Record<string, React.ComponentType> = {
  '/': Home,
  '/builder': Builder,
  '/prebuilts': Prebuilts,
  '/compare': Compare,
  '/about': About,
  '/build': SharedBuild,
};

export const PRERENDER_ROUTES = Object.keys(PAGES);

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
