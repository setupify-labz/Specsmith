import { migrateLegacyStorage } from './lib/storage';

migrateLegacyStorage();

// No-flash theme: set data-theme before React renders
(function() {
  try {
    const t = localStorage.getItem('specsmith-theme');
    if (t === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    }
  } catch {}
})();

import { createRoot, hydrateRoot } from "react-dom/client";
import App from "./App";
import KrystalViewAnalytics from "./components/KrystalViewAnalytics";
import "./index.css";

// The analytics component renders nothing until the client reads the saved
// consent choice, so it does not change the prerendered HTML or hydration
// boundary. Recording is loaded only after the visitor explicitly accepts.
const app = (
  <>
    <App />
    <KrystalViewAnalytics />
  </>
);

// The site is prerendered (scripts/prerender.mjs writes real HTML for every
// route), so the initial DOM already has the correct content. Using
// createRoot().render() here — instead of hydrateRoot() — was discarding
// that entire prerendered tree and rebuilding it from scratch the instant
// the JS bundle executed: the page would flash to just Navbar+Footer for a
// few hundred ms and then snap back, which is exactly what was driving
// Lighthouse's Cumulative Layout Shift score above 1.0. hydrateRoot()
// attaches to the existing markup instead of replacing it.
// Query params carry client-only state the prerendered HTML can't know about
// (/builder?gpu=..., /build?b=...) — hydrating against that mismatched markup
// throws React #418 and falls back to a client render anyway, so skip
// straight to the client render and save the console error.
const root = document.getElementById("root")!;
if (root.hasChildNodes() && !window.location.search) {
  hydrateRoot(root, app);
} else {
  // Also the fallback for the (non-prerendered) dev server, where #root
  // starts empty.
  createRoot(root).render(app);
}
