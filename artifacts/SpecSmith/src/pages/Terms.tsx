import { Link } from 'react-router-dom';
import { useSeo } from '../hooks/useSeo';
import { getRouteMeta } from '../lib/seo';

const UPDATED = 'September 19, 2026';

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <h2 className="text-xl font-black" style={{ color: 'var(--ff-text)' }}>{title}</h2>
      <div className="space-y-2 text-sm leading-7" style={{ color: 'var(--ff-text-2)' }}>{children}</div>
    </section>
  );
}

export default function Terms() {
  useSeo(getRouteMeta('/terms'));
  return (
    <main className="min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <div className="mx-auto max-w-3xl px-4 sm:px-6">
        <h1 className="text-4xl font-black" style={{ color: 'var(--ff-text)' }}>Terms of Use</h1>
        <p className="mt-2 text-sm" style={{ color: 'var(--ff-text-3)' }}>Last updated {UPDATED}</p>

        <div className="mt-8 space-y-9 rounded-2xl p-6 sm:p-8" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
          <Section title="Using SpecSmith">
            <p>By using SpecSmith, you agree to these terms. The public tools can be used without an account. You must be at least 13 to create an account or submit content. If you do not agree, do not use the service.</p>
          </Section>

          <Section title="Estimates are planning tools">
            <p>FPS, compatibility, price, power, value, resale, and upgrade figures are estimates or limited checks—not guarantees, professional advice, measured results from your computer, or confirmation that every exact product will work together. Data can be incomplete, delayed, or wrong.</p>
            <p>Before buying or changing hardware, verify exact model numbers, dimensions, connectors, firmware, warranties, prices, availability, and requirements with manufacturers and retailers. You are responsible for purchase and installation decisions.</p>
          </Section>

          <Section title="Retailers and affiliate relationships">
            <p>Retailer links lead to third-party services that SpecSmith does not control. Prices and availability can change after they were checked. Some links are affiliate links; SpecSmith may earn a commission from qualifying purchases. Commission does not determine compatibility results, performance estimates, or the order of technical comparisons.</p>
          </Section>

          <Section title="Accounts and acceptable use">
            <p>Keep your login secure and provide accurate account information. Do not misuse the service, interfere with its operation, scrape it in a way that degrades availability, bypass access controls, upload malicious material, impersonate others, or use the service unlawfully.</p>
            <p>We may suspend or remove accounts or content that violate these terms, threaten the service, or create legal or security risk.</p>
          </Section>

          <Section title="Your content">
            <p>You keep ownership of build names, notes, and other content you submit. When you publish content, you give SpecSmith a non-exclusive, worldwide, royalty-free license to host, reproduce, display, and distribute it only as needed to operate and promote the service. You confirm that you have the right to submit it.</p>
          </Section>

          <Section title="SpecSmith content and availability">
            <p>SpecSmith&apos;s software, design, data organization, and original content are protected by applicable intellectual-property laws. You may use the service for personal and lawful purposes, but may not copy or resell substantial portions without permission.</p>
            <p>We may change, pause, or discontinue features. We do not promise uninterrupted access or that every error will be corrected.</p>
          </Section>

          <Section title="Disclaimers and limits">
            <p>The service is provided “as is” and “as available,” to the fullest extent permitted by law. SpecSmith disclaims implied warranties, including merchantability, fitness for a particular purpose, and non-infringement.</p>
            <p>To the fullest extent permitted by law, SpecSmith is not liable for indirect, incidental, special, consequential, or punitive damages, lost data or profits, hardware damage, or purchasing losses arising from use of the service. Rights that cannot legally be waived remain unaffected.</p>
          </Section>

          <Section title="Changes and contact">
            <p>We may update these terms. Continued use after an update means you accept the revised terms. Material changes will be identified by the revision date above.</p>
            <p>Questions can be sent to <a className="font-semibold" style={{ color: 'var(--ff-accent-text)' }} href="mailto:developer@specsmithpc.com">developer@specsmithpc.com</a>. Read our <Link to="/privacy" className="font-semibold" style={{ color: 'var(--ff-accent-text)' }}>Privacy Policy</Link> for information about data handling.</p>
          </Section>
        </div>
      </div>
    </main>
  );
}
