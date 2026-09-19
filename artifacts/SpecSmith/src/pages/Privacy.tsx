import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useSeo } from '../hooks/useSeo';
import { getRouteMeta } from '../lib/seo';
import { resetAnalyticsConsent } from '../lib/productAnalytics';

const UPDATED = 'September 19, 2026';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xl font-black" style={{ color: 'var(--ff-text)' }}>{title}</h2>
      <div className="space-y-2 text-sm leading-7" style={{ color: 'var(--ff-text-2)' }}>{children}</div>
    </section>
  );
}

export default function Privacy() {
  useSeo(getRouteMeta('/privacy'));
  const [reset, setReset] = useState(false);

  const resetChoice = () => {
    resetAnalyticsConsent();
    setReset(true);
  };

  return (
    <main className="min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <h1 className="text-4xl font-black" style={{ color: 'var(--ff-text)' }}>Privacy Policy</h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--ff-text-3)' }}>Last updated {UPDATED}</p>

        <div className="mt-8 space-y-9 rounded-2xl p-6 sm:p-8" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
          <Section title="The short version">
            <p>SpecSmith&apos;s core PC building and research tools work without an account. Analytics is optional and stays off unless you accept it. We do not sell personal information.</p>
          </Section>

          <Section title="Information stored in your browser">
            <p>Theme, analytics consent, dismissed prompts, and some draft or migration state may be stored locally in your browser. This data normally stays on your device and can be cleared through your browser settings.</p>
          </Section>

          <Section title="Accounts, saved builds, and community content">
            <p>If you create an account, our account provider Supabase processes your email address, username, login credentials, profile preferences, and authentication data. Passwords are handled by Supabase and are not available to SpecSmith.</p>
            <p>Saved builds, build names, notes, sharing counts, and account preferences are stored so those features work. Content you deliberately publish to the Gallery is public and may include your display name and build details.</p>
          </Section>

          <Section title="Optional analytics">
            <p>If you accept analytics, KrystalView may receive page paths, device and browser details, clicks, masked session-replay data, performance information, and errors. All form inputs are masked. We also add coarse product events such as “builder started,” “estimate viewed,” or “retailer link clicked.” These events do not include email addresses, account IDs, selected-part IDs, build payloads, retailer destination URLs, or FPS values.</p>
            <p>You can decline when prompted or reset your choice below. Declining does not limit the site&apos;s tools.</p>
            <button
              type="button"
              onClick={resetChoice}
              className="rounded-lg px-4 py-2 text-sm font-semibold"
              style={{ border: '1px solid var(--ff-border)', color: 'var(--ff-accent-text)' }}
            >
              {reset ? 'Choice reset — choose again when prompted' : 'Reset analytics choice'}
            </button>
          </Section>

          <Section title="Retailer and affiliate links">
            <p>When you open a retailer link, that retailer receives the information browsers ordinarily send, such as your IP address, browser details, and referring page. Some links are affiliate links, which may let SpecSmith earn a commission without changing your price. Retailers apply their own privacy policies.</p>
          </Section>

          <Section title="How information is used and shared">
            <p>We use information to operate accounts, save and share builds, secure and troubleshoot the service, understand which features help visitors, and improve SpecSmith. We share data with service providers only as needed to provide those functions, including Supabase for accounts and KrystalView for analytics you accept, or when legally required.</p>
          </Section>

          <Section title="Retention and your choices">
            <p>Browser data remains until it expires or you clear it. Account and saved-build data remains while your account is active or as needed to provide the service. You can delete your account from Settings. Service providers may retain limited security, backup, or legal records under their own policies.</p>
            <p>For access, correction, deletion, or privacy questions, email <a className="font-semibold" style={{ color: 'var(--ff-accent-text)' }} href="mailto:developer@specsmithpc.com">developer@specsmithpc.com</a>.</p>
          </Section>

          <Section title="Children">
            <p>The public tools do not require an account. Accounts and user submissions are for people age 13 or older. We do not knowingly collect personal information through an account from a child under 13. A parent or guardian who believes a child provided personal information should contact us so we can investigate and delete it.</p>
          </Section>

          <Section title="Security and changes">
            <p>We use reasonable safeguards, but no online service is completely secure. We may update this policy as the service changes; the date at the top will show the latest revision.</p>
            <p>See also our <Link to="/terms" className="font-semibold" style={{ color: 'var(--ff-accent-text)' }}>Terms of Use</Link>.</p>
          </Section>
        </div>
      </div>
    </main>
  );
}
