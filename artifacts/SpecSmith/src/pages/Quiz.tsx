import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import QuizFlow from '../components/QuizFlow';
import { QUIZ_USE_CASES, quizFaqJsonLd } from '../lib/quiz';
import { useSeo } from '../hooks/useSeo';
import { getRouteMeta } from '../lib/seo';
import PageGlow from '../components/PageGlow';

const faqs = [
  {
    title: 'How does the PC Build Quiz pick a GPU and CPU?',
    content: 'Two quick questions — what you\'ll use the PC for, and your budget — map to the same tier-based picking logic used throughout SpecSmith\'s build guides: GPU and CPU are chosen from real, priced parts based on what that specific workload actually needs (VRAM for editing, NVENC support for streaming, raw benchmark score for gaming), not a generic "best overall" list.',
  },
  {
    title: 'Can I change my answers after seeing a result?',
    content: 'Yes — hit "Retake Quiz" on the result screen to start over, or use the Back button to change just your use case without losing your place.',
  },
  {
    title: 'What happens after I get a recommendation?',
    content: 'Click "Load in Builder" to open the full PC Builder with that GPU and CPU pre-selected, where you can add the rest of your parts (RAM, storage, PSU, case) and see live compatibility checks and estimated FPS.',
  },
];

export default function Quiz() {
  useSeo(getRouteMeta('/quiz'));

  return (
    <div className="relative min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(quizFaqJsonLd(faqs)) }} />
      <PageGlow />
      <div className="relative max-w-2xl mx-auto px-4 sm:px-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8">
          <h1 className="text-4xl sm:text-5xl font-black mb-4" style={{ color: 'var(--ff-text)' }}>
            What PC Should <span className="gradient-text">I Get?</span>
          </h1>
          <p className="text-lg max-w-xl mx-auto" style={{ color: 'var(--ff-text-2)' }}>
            Answer 2 questions and get a matched GPU + CPU pick with real prices — no browsing required.
          </p>
        </motion.div>

        <QuizFlow />

        <div className="mt-10">
          <p className="text-xs font-bold uppercase tracking-wider mb-3 text-center" style={{ color: 'var(--ff-text-3)' }}>
            Or jump straight to a use case
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {QUIZ_USE_CASES.map((u) => (
              <Link key={u.slug} to={`/quiz/${u.slug}`}
                className="flex items-center justify-between rounded-xl p-3 transition-all hover:opacity-90 card-hover"
                style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
                <span className="text-sm font-semibold" style={{ color: 'var(--ff-text)' }}>{u.label} Quiz</span>
                <ChevronRight size={14} style={{ color: 'var(--ff-text-3)' }} />
              </Link>
            ))}
          </div>
        </div>

        <div className="space-y-3 mt-12">
          {faqs.map((f) => (
            <div key={f.title} className="rounded-xl p-4" style={{ border: '1px solid var(--ff-border)', backgroundColor: 'var(--ff-surface)' }}>
              <h2 className="font-bold text-sm mb-1.5" style={{ color: 'var(--ff-text)' }}>{f.title}</h2>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>{f.content}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
