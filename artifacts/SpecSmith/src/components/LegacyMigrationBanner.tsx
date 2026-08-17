import { useState, useRef, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, X } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { isMigrationPromptDismissedThisSession, dismissMigrationPromptThisSession } from '../lib/authMigration';

const BANNER_HEIGHT_VAR = '--legacy-banner-h';

// Prominent, hard-to-miss notice for anyone with pre-migration localStorage
// builds (see authMigration.ts) — dismissible for the current browser
// session only, so it comes back on the next visit until the data is
// actually migrated (or lost some other way). Renders nothing server-side
// or on first client paint (legacyAccount starts null and is only set by
// AuthContext's mount effect), so it never causes a hydration mismatch.
export default function LegacyMigrationBanner() {
  const { user, legacyAccount, migrateLegacyBuilds } = useAuth();
  const { showToast } = useToast();
  const [dismissed, setDismissed] = useState(false);
  const [migrating, setMigrating] = useState(false);
  const bannerRef = useRef<HTMLDivElement>(null);

  const visible = !!legacyAccount && legacyAccount.builds.length > 0
    && !dismissed && !isMigrationPromptDismissedThisSession();

  // Navbar.tsx reads this to shift itself down by exactly this banner's
  // rendered height, instead of the fixed navbar overlapping/hiding it —
  // that overlap was the actual production bug this fixes. A
  // ResizeObserver (not a one-time measurement) keeps it correct as the
  // banner's text wraps differently across viewport widths.
  useEffect(() => {
    if (!visible || !bannerRef.current) {
      document.documentElement.style.removeProperty(BANNER_HEIGHT_VAR);
      return;
    }
    const el = bannerRef.current;
    const setHeight = () => document.documentElement.style.setProperty(BANNER_HEIGHT_VAR, `${el.offsetHeight}px`);
    setHeight();
    const observer = new ResizeObserver(setHeight);
    observer.observe(el);
    return () => {
      observer.disconnect();
      document.documentElement.style.removeProperty(BANNER_HEIGHT_VAR);
    };
  }, [visible]);

  if (!visible) return null;

  const count = legacyAccount.builds.length;
  const plural = count === 1 ? '' : 's';
  const pronoun = count === 1 ? 'it' : 'them';

  const handleDismiss = () => {
    dismissMigrationPromptThisSession();
    setDismissed(true);
  };

  const handleMigrate = async () => {
    setMigrating(true);
    const result = await migrateLegacyBuilds();
    setMigrating(false);
    if (result.ok) {
      showToast(`Migrated ${result.migratedCount} build${result.migratedCount === 1 ? '' : 's'} to your account!`, 'success');
    } else if (result.migratedCount > 0) {
      showToast(`Migrated ${result.migratedCount} of ${result.migratedCount + result.remainingCount} builds — ${result.error ?? 'the rest could not be migrated yet'}`, 'warning');
    } else {
      showToast(result.error ?? 'Could not migrate your builds', 'error');
    }
  };

  return (
    <div
      ref={bannerRef}
      role="alert"
      className="relative z-40 px-4 py-3 text-sm font-medium flex flex-wrap items-center justify-center gap-3 text-center"
      style={{ backgroundColor: '#FFB30018', borderBottom: '1px solid #FFB30040', color: 'var(--ff-amber)' }}
    >
      <AlertTriangle size={16} className="shrink-0" />
      {user ? (
        <>
          <span>
            We found {count} saved build{plural} from your old local account ("{legacyAccount.username}"). Migrate {pronoun} to your real account to keep {pronoun} — local-only builds are lost if this browser's data is ever cleared.
          </span>
          <button
            onClick={handleMigrate}
            disabled={migrating}
            className="px-3 py-1.5 rounded-lg font-bold text-xs text-white disabled:opacity-60 shrink-0"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}
          >
            {migrating ? 'Migrating…' : `Migrate ${count} Build${plural}`}
          </button>
        </>
      ) : (
        <>
          <span>
            We found {count} saved build{plural} from your old local account. Create a free account (or log in) to migrate {pronoun} — they're lost if this browser's data is ever cleared.
          </span>
          <Link
            to="/signup"
            className="px-3 py-1.5 rounded-lg font-bold text-xs text-white shrink-0"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}
          >
            Sign Up
          </Link>
          <Link
            to="/login"
            className="px-3 py-1.5 rounded-lg font-bold text-xs shrink-0"
            style={{ border: '1px solid var(--ff-amber)', color: 'var(--ff-amber)' }}
          >
            Log In
          </Link>
        </>
      )}
      <button onClick={handleDismiss} aria-label="Dismiss migration notice" className="ml-1 p-1 rounded shrink-0" style={{ color: 'var(--ff-amber)' }}>
        <X size={14} />
      </button>
    </div>
  );
}
