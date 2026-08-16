import { useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, ExternalLink, RotateCcw, Sparkles } from 'lucide-react';
import { QUIZ_USE_CASES, getQuizTiers, getQuizResult } from '../lib/quiz';
import { getAffiliateUrl, getNeweggUrl, buildPartQuery } from '../lib/fps';

interface QuizFlowProps {
  lockedUseCase?: string;
}

export default function QuizFlow({ lockedUseCase }: QuizFlowProps) {
  const [useCaseSlug, setUseCaseSlug] = useState<string | null>(lockedUseCase ?? null);
  const [tierIndex, setTierIndex] = useState<number | null>(null);

  const result = useCaseSlug !== null && tierIndex !== null ? getQuizResult(useCaseSlug, tierIndex) : null;
  const step = result ? 3 : useCaseSlug ? 2 : 1;

  function reset() {
    setUseCaseSlug(lockedUseCase ?? null);
    setTierIndex(null);
  }

  return (
    <div className="rounded-2xl p-6" style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}>
      <AnimatePresence mode="wait">
        {step === 1 && (
          <motion.div key="step1" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <p className="text-xs font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--ff-accent-text)' }}>Question 1 of 2</p>
            <h2 className="font-bold text-lg mb-4" style={{ color: 'var(--ff-text)' }}>What will you mainly use this PC for?</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {QUIZ_USE_CASES.map((u) => (
                <button key={u.slug} onClick={() => setUseCaseSlug(u.slug)}
                  className="text-left p-3 rounded-xl transition-all hover:opacity-90 card-hover"
                  style={{ backgroundColor: 'var(--ff-card)', border: '1px solid var(--ff-border)' }}>
                  <span className="font-semibold text-sm block" style={{ color: 'var(--ff-text)' }}>{u.label}</span>
                  <span className="text-xs" style={{ color: 'var(--ff-text-3)' }}>{u.description}</span>
                </button>
              ))}
            </div>
          </motion.div>
        )}

        {step === 2 && useCaseSlug && (
          <motion.div key="step2" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -8 }}>
            <p className="text-xs font-bold uppercase tracking-wider mb-4" style={{ color: 'var(--ff-accent-text)' }}>Question 2 of 2</p>
            <h2 className="font-bold text-lg mb-4" style={{ color: 'var(--ff-text)' }}>What's your budget?</h2>
            <div className="grid grid-cols-1 gap-2">
              {getQuizTiers(useCaseSlug).map((t) => (
                <button key={t.index} onClick={() => setTierIndex(t.index)}
                  className="flex items-center justify-between p-3 rounded-xl transition-all hover:opacity-90 card-hover"
                  style={{ backgroundColor: 'var(--ff-card)', border: '1px solid var(--ff-border)' }}>
                  <span className="font-semibold text-sm" style={{ color: 'var(--ff-text)' }}>{t.label}</span>
                  <ChevronRight size={14} style={{ color: 'var(--ff-text-3)' }} />
                </button>
              ))}
            </div>
            {!lockedUseCase && (
              <button onClick={() => setUseCaseSlug(null)} className="text-xs mt-4 hover:opacity-80" style={{ color: 'var(--ff-text-3)' }}>
                ← Back
              </button>
            )}
          </motion.div>
        )}

        {step === 3 && result && (
          <motion.div key="step3" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex items-center gap-2 mb-4">
              <Sparkles size={16} style={{ color: 'var(--ff-accent)' }} />
              <p className="text-xs font-bold uppercase tracking-wider" style={{ color: 'var(--ff-accent-text)' }}>
                Your {result.tierLabel} pick for {result.useCase.label}
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
              {([
                { label: 'GPU', part: result.gpu, category: 'gpu' as const },
                { label: 'CPU', part: result.cpu, category: 'cpu' as const },
              ]).map(({ label, part, category }) => (
                <div key={label} className="rounded-xl p-4" style={{ backgroundColor: 'var(--ff-card)', border: '1px solid var(--ff-border)' }}>
                  <p className="text-[10px] uppercase tracking-wider mb-0.5" style={{ color: 'var(--ff-text-3)' }}>{label}</p>
                  <p className="font-bold text-sm" style={{ color: 'var(--ff-text)' }}>{part.name}</p>
                  <div className="flex items-center gap-2 text-xs mt-2 flex-wrap">
                    <span className="font-bold" style={{ color: 'var(--ff-text)' }}>${part.price_usd.toLocaleString()}</span>
                    <a href={getAffiliateUrl(buildPartQuery(part.name, part.brand, category))} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 hover:opacity-80" style={{ color: 'var(--ff-accent-text)' }}>
                      Amazon <ExternalLink size={9} />
                    </a>
                    <a href={getNeweggUrl(buildPartQuery(part.name, part.brand, category))} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 hover:opacity-80" style={{ color: 'var(--ff-newegg)' }}>
                      Newegg <ExternalLink size={9} />
                    </a>
                  </div>
                </div>
              ))}
            </div>

            <div className="flex flex-col sm:flex-row gap-3">
              <Link to={`/builder?gpu=${result.gpu.id}&cpu=${result.cpu.id}`}
                className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90"
                style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}>
                Load in Builder <ChevronRight size={14} />
              </Link>
              <button onClick={reset}
                className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all hover:opacity-80"
                style={{ backgroundColor: 'var(--ff-card)', color: 'var(--ff-text)', border: '1px solid var(--ff-border)' }}>
                <RotateCcw size={14} /> Retake Quiz
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
