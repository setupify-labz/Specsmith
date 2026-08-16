import { useParams, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronRight } from 'lucide-react';
import QuizFlow from '../components/QuizFlow';
import { QUIZ_USE_CASES, getQuizUseCase, getQuizPageMeta, quizFaqJsonLd } from '../lib/quiz';
import { getUseCase } from '../lib/useCaseBuilds';
import { useSeo } from '../hooks/useSeo';
import PageGlow from '../components/PageGlow';

export default function QuizLanding() {
  const { slug } = useParams<{ slug: string }>();
  const useCase = slug ? getQuizUseCase(slug) : undefined;

  const fallbackMeta = {
    path: '/quiz',
    title: 'PC Build Quiz Not Found | SpecSmith',
    description: 'This quiz page could not be found. Take the full PC Build Quiz instead.',
    noindex: true,
  };
  useSeo(useCase && slug ? getQuizPageMeta(slug) : fallbackMeta);

  if (!useCase || !slug) {
    return (
      <div className="min-h-screen pt-24 flex items-center justify-center px-4">
        <div className="text-center">
          <p className="text-2xl font-bold mb-2" style={{ color: 'var(--ff-text)' }}>Quiz page not found</p>
          <p className="text-sm mb-6" style={{ color: 'var(--ff-text-2)' }}>We don't have a dedicated quiz for this yet.</p>
          <Link to="/quiz" className="px-6 py-3 rounded-xl font-bold text-sm text-white"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
            Take the Full Quiz
          </Link>
        </div>
      </div>
    );
  }

  const criteria = getUseCase(slug)?.criteria
    ?? 'GPU and CPU are picked by highest benchmark score within your budget — the same tier data used throughout SpecSmith\'s FPS estimator.';

  const faqs = [
    {
      title: `How does this quiz pick a GPU and CPU for ${useCase.label.toLowerCase()}?`,
      content: criteria,
    },
    {
      title: 'Can I change my budget after seeing a result?',
      content: 'Yes — hit "Retake Quiz" on the result screen to pick a different budget tier.',
    },
    {
      title: `Is this the same as SpecSmith's ${useCase.label} build guide?`,
      content: slug !== 'gaming'
        ? `Yes — this quiz uses the exact same picking logic as the dedicated ${useCase.label} build guide, just condensed into one budget question instead of showing all three tiers at once.`
        : 'Yes — the picks come from the same GPU/CPU benchmark data used throughout SpecSmith\'s FPS estimator and build guides.',
    },
  ];

  const related = QUIZ_USE_CASES.filter((u) => u.slug !== slug);

  return (
    <div className="relative min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(quizFaqJsonLd(faqs)) }} />
      <PageGlow />
      <div className="relative max-w-2xl mx-auto px-4 sm:px-6">
        <Link to="/quiz" className="inline-flex items-center gap-1 text-sm font-medium mb-6 transition-colors"
          style={{ color: 'var(--ff-text-2)' }}>
          ← Full PC Build Quiz
        </Link>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8">
          <h1 className="text-3xl sm:text-5xl font-black mb-4" style={{ color: 'var(--ff-text)' }}>
            PC Build Quiz: <span className="gradient-text">{useCase.label}</span>
          </h1>
          <p className="text-base max-w-xl mx-auto leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>
            {useCase.description} Answer one question about your budget to get a matched GPU + CPU pick.
          </p>
        </motion.div>

        <QuizFlow lockedUseCase={slug} />

        {slug !== 'gaming' && (
          <div className="text-center mt-6">
            <Link to={`/best-pc-for/${slug}`} className="text-xs font-medium hover:opacity-80" style={{ color: 'var(--ff-accent-text)' }}>
              See all 3 budget tiers on the full {useCase.label} build guide →
            </Link>
          </div>
        )}

        {related.length > 0 && (
          <div className="rounded-2xl p-6 mt-10" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
            <h2 className="font-bold mb-3 text-sm" style={{ color: 'var(--ff-text)' }}>Other Quizzes</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {related.map((r) => (
                <Link key={r.slug} to={`/quiz/${r.slug}`}
                  className="flex items-center justify-between text-sm py-2 px-3 rounded-lg transition-colors hover:opacity-80"
                  style={{ color: 'var(--ff-text-2)', backgroundColor: 'var(--ff-card)' }}>
                  <span>{r.label} Quiz</span>
                  <ChevronRight size={14} />
                </Link>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-3 mt-10">
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
