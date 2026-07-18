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
import "./index.css";

// The site is prerendered (scripts/prerender.mjs writes real HTML for every
// route), so the initial DOM already has the correct content. Using
// createRoot().render() here — instead of hydrateRoot() — was discarding
// that entire prerendered tree and rebuilding it from scratch the instant
// the JS bundle executed: the page would flash to just Navbar+Footer for a
// few hundred ms and then snap back, which is exactly what was driving
// Lighthouse's Cumulative Layout Shift score above 1.0. hydrateRoot()
// attaches to the existing markup instead of replacing it.
const root = document.getElementById("root")!;
if (root.hasChildNodes()) {
  hydrateRoot(root, <App />);
} else {
  // Fallback for the (non-prerendered) dev server, where #root starts empty.
  createRoot(root).render(<App />);
}
