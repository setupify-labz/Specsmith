import { createContext, useContext, useEffect, useRef, useState } from 'react';

type Theme = 'dark' | 'light';

interface ThemeContextType {
  theme: Theme;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextType>({ theme: 'dark', toggleTheme: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Always start from 'dark' — the same default the server uses — so the
  // client's first render matches the prerendered HTML exactly. Reading
  // localStorage inside the useState initializer (the old approach) made
  // the client's very first render differ from the server's whenever a
  // user had 'light' saved, which is exactly what React reports as
  // hydration error #418. The saved theme is applied to the DOM before
  // paint by the no-flash inline script in main.tsx, then synced into
  // this state right after mount below (a normal post-hydration
  // re-render, not a hydration mismatch).
  const [theme, setTheme] = useState<Theme>('dark');
  const skipNextDomWrite = useRef(true);

  useEffect(() => {
    try {
      const stored = localStorage.getItem('specsmith-theme');
      if (stored === 'light') setTheme('light');
    } catch {}
  }, []);

  useEffect(() => {
    // The first run just mirrors the initial 'dark' state — the DOM
    // attribute is already correct (set by the inline script), so skip it
    // to avoid a one-frame flash back to dark for light-theme users.
    if (skipNextDomWrite.current) {
      skipNextDomWrite.current = false;
      return;
    }
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : '');
    try {
      localStorage.setItem('specsmith-theme', theme);
    } catch {}
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
