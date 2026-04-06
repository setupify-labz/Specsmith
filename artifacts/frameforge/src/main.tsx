// No-flash theme: set data-theme before React renders
(function() {
  try {
    const t = localStorage.getItem('frameforge-theme');
    if (t === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
    }
  } catch {}
})();

import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(<App />);
