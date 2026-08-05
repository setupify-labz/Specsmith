import { motion } from 'framer-motion';
import { Zap, Calculator, Shield, BarChart3 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useSeo } from '../hooks/useSeo';
import { getRouteMeta } from '../lib/seo';
import PageGlow from '../components/PageGlow';

const sections = [
  {
    icon: <Calculator size={20} className="text-[#6C63FF]" />,
    title: 'How does SpecSmith estimate FPS?',
    content: `SpecSmith uses a data-driven algorithm to estimate gaming performance based on two key components: your GPU tier and CPU tier. Each component is scored on a 1-10 tier scale based on benchmark data from thousands of real-world gaming tests.

The estimation formula works as follows:

1. We start with a base FPS value for each game at each resolution/quality combination — this represents the expected output on top-tier hardware.

2. We apply a GPU modifier: gpu_modifier = gpu_tier / 10. A tier-10 GPU gets the full 100% of base FPS, while a tier-5 gets 50%.

3. We apply a CPU modifier: cpu_modifier = 0.85 + (cpu_tier / 10) × 0.30. This reflects that CPU bottlenecks are less severe than GPU ones, with even budget CPUs delivering 85% of potential.

4. The estimated FPS = base_fps × gpu_modifier × cpu_modifier.

5. We calculate a realistic range: ±12% from the estimated value to reflect real-world variation.`
  },
  {
    icon: <BarChart3 size={20} className="text-[var(--ff-cyan)]" />,
    title: 'Where does the benchmark data come from?',
    content: `Our benchmark data is aggregated from multiple sources including manufacturer specifications, independent hardware reviews, and community-sourced gaming benchmarks. We cross-reference results across multiple testing methodologies to ensure accuracy.

Each GPU and CPU in our database includes a benchmark score that reflects its real-world gaming performance relative to other products. These scores are regularly updated to reflect driver improvements, game patches, and newly released hardware.

For games, we benchmark at multiple quality presets and resolutions to capture the full performance envelope. Games are tested with their latest patches and graphics settings documentation from developers.`
  },
  {
    icon: <Shield size={20} className="text-[var(--ff-green)]" />,
    title: 'What does the compatibility checker actually check?',
    content: `SpecSmith checks three critical compatibility factors:

Socket Compatibility: CPU socket must match motherboard socket. For example, Intel 12th/13th/14th Gen CPUs use LGA1700 and require an LGA1700 motherboard. AMD Ryzen 7000 series uses AM5, while Ryzen 5000 uses AM4.

RAM Compatibility: The RAM type (DDR4 vs DDR5) must be supported by both the CPU platform and motherboard. Some platforms support both (Intel 12th/13th/14th Gen), while newer AMD Ryzen 7000 requires DDR5 only.

PSU Wattage: The power supply must provide enough wattage for the GPU TDP + CPU TDP + 100W system overhead. We warn when your PSU is insufficient and alert when headroom is tight.`
  },
  {
    icon: <Zap size={20} className="text-[var(--ff-amber)]" />,
    title: 'What do the FPS estimates not account for?',
    content: `FPS estimates are approximations and will vary in practice. Factors we don't account for include:

- Ray tracing and path tracing workloads (shown estimates are for rasterization)
- Frame generation (DLSS Frame Gen, FSR Frame Generation)
- Upscaling technologies (DLSS, FSR, XeSS) which can significantly boost FPS
- Specific driver versions and optimizations
- Game engine optimizations and per-title CPU threading behavior
- RAM speed, dual-channel configuration, and XMP/EXPO profiles
- Storage speed impact on loading times (not FPS)
- Thermal throttling on poorly cooled systems
- Background applications and OS overhead

Use SpecSmith estimates as a starting point for your research, not a guarantee. We recommend checking independent reviews for the specific hardware you're considering.`
  },
  {
    icon: <Calculator size={20} className="text-[var(--ff-accent-text)]" />,
    title: 'Is SpecSmith free, and do I need an account?',
    content: `SpecSmith is completely free with no account required — the Builder, FPS estimates, compatibility checks, and every comparison and guide page are open to anyone. Creating an account is optional and only unlocks saving builds, sharing them, and publishing to the Gallery; nothing about pricing or performance data is gated behind it.`
  },
  {
    icon: <BarChart3 size={20} className="text-[var(--ff-cyan)]" />,
    title: "What if my GPU or CPU isn't in your list?",
    content: `The Builder lets you add a custom part with your own name and price if it's not in our database yet — you'll still get accurate compatibility checks for everything around it, though FPS estimates require a tracked GPU and CPU since those numbers come from tier data we maintain. We're regularly adding newly released hardware.`
  },
];

// Generated from the same `sections` array rendered below, so the
// structured data can never drift from what's actually visible on the page.
const faqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: sections.map((s) => ({
    '@type': 'Question',
    name: s.title,
    acceptedAnswer: { '@type': 'Answer', text: s.content },
  })),
};

export default function About() {
  useSeo(getRouteMeta('/about'));
  return (
    <div className="relative min-h-screen pt-24 pb-20">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }} />
      <PageGlow />
      <div className="relative max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-16"
        >
          <h1 className="text-4xl sm:text-5xl font-black mb-4" style={{ color: 'var(--ff-text)' }}>
            About <span className="gradient-text">SpecSmith</span>
          </h1>
          <p className="text-lg max-w-2xl mx-auto" style={{ color: 'var(--ff-text-2)' }}>
            SpecSmith exists to remove the guesswork from PC building. We believe everyone deserves to know exactly what performance they'll get before committing their hard-earned money.
          </p>
        </motion.div>

        {/* Mission */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="rounded-2xl p-8 mb-8 text-center"
          style={{ background: 'linear-gradient(135deg, rgba(108,99,255,0.12), rgba(0,212,255,0.06))' }}
        >
          <p className="text-2xl font-bold italic" style={{ color: 'var(--ff-text)' }}>
            "Build it. Benchmark it. Own it."
          </p>
          <p className="mt-3" style={{ color: 'var(--ff-text-2)' }}>
            Our mission is to democratize PC performance knowledge — making it accessible to first-time builders and seasoned enthusiasts alike.
          </p>
        </motion.div>

        {/* Sections */}
        <div className="space-y-6">
          {sections.map((s, i) => (
            <motion.div
              key={s.title}
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ delay: i * 0.05 }}
              className="rounded-2xl p-6"
              style={{ border: '1px solid var(--ff-border)', backgroundColor: 'var(--ff-surface)' }}
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ backgroundColor: 'var(--ff-card)', border: '1px solid var(--ff-border)' }}>
                  {s.icon}
                </div>
                <h2 className="font-bold text-lg" style={{ color: 'var(--ff-text)' }}>{s.title}</h2>
              </div>
              <div className="text-sm leading-relaxed whitespace-pre-line" style={{ color: 'var(--ff-text-2)' }}>
                {s.content}
              </div>
            </motion.div>
          ))}
        </div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="text-center mt-16"
        >
          <p className="mb-6" style={{ color: 'var(--ff-text-2)' }}>Ready to put it to use?</p>
          <Link
            to="/builder"
            className="inline-flex items-center gap-2 px-8 py-4 rounded-xl text-white font-bold text-lg hover:opacity-90 hover:scale-105 transition-all"
            style={{ background: 'linear-gradient(135deg, #6C63FF, #00D4FF)' }}
          >
            Open the Builder
          </Link>
        </motion.div>
      </div>
    </div>
  );
}
