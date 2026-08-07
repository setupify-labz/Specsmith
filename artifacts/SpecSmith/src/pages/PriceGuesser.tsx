import { useState, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUp, ArrowDown, Trophy, RotateCcw, Cpu, Share2 } from 'lucide-react';
import PageGlow from '../components/PageGlow';
import { useSeo } from '../hooks/useSeo';
import { getRouteMeta, SITE_URL } from '../lib/seo';
import { useToast } from '../context/ToastContext';
import { pickStartingPair, pickNextItem, type GuesserItem } from '../lib/priceGuesser';

const BEST_KEY = 'specsmith-guesser-best';

// Generated into FAQPage JSON-LD below so it can't drift from what's
// actually on the page.
const guesserFaqSections = [
  {
    title: 'Where do the prices come from?',
    content: 'The exact same street-pricing dataset that powers the Builder and Compare pages — no separate numbers made up for the game.',
  },
  {
    title: 'Why can\'t I lose points, only my streak?',
    content: 'It\'s a streak game, not a scored quiz — one wrong guess ends the run and your best streak is saved locally in your browser. There\'s no account, no server-side leaderboard, and no way to lose progress on parts you\'ve already correctly guessed.',
  },
  {
    title: 'Do I need an account to play?',
    content: 'No. It\'s free with no sign-up, and your best streak persists across visits via your browser\'s local storage only.',
  },
  {
    title: 'Can two GPUs or CPUs ever tie on price?',
    content: 'The game deliberately avoids pairing items with identical prices, since "higher or lower" would be unanswerable — every round has a real, decidable answer.',
  },
];

const guesserFaqJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: guesserFaqSections.map((s) => ({
    '@type': 'Question',
    name: s.title,
    acceptedAnswer: { '@type': 'Answer', text: s.content },
  })),
};

function readBest(): number {
  try {
    return Number(localStorage.getItem(BEST_KEY)) || 0;
  } catch {
    return 0;
  }
}

function ItemCard({ item, revealPrice, highlight }: { item: GuesserItem; revealPrice: boolean; highlight?: 'correct' | 'wrong' }) {
  return (
    <motion.div
      layout
      className="rounded-2xl p-6 text-center flex-1"
      style={{
        backgroundColor: 'var(--ff-surface)',
        border: `1px solid ${highlight === 'correct' ? 'var(--ff-green)' : highlight === 'wrong' ? 'var(--ff-red)' : 'var(--ff-border)'}`,
      }}
    >
      <span
        className="inline-block text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full mb-3"
        style={{ backgroundColor: 'var(--ff-card)', color: 'var(--ff-text-3)' }}
      >
        {item.category} · {item.brand}
      </span>
      <h3 className="text-xl font-black mb-1" style={{ color: 'var(--ff-text)' }}>{item.name}</h3>
      <p className="text-xs mb-4" style={{ color: 'var(--ff-text-3)' }}>{item.stat}</p>
      {revealPrice ? (
        <motion.p
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className="text-3xl font-black"
          style={{ color: 'var(--ff-text)' }}
        >
          ${item.price.toLocaleString()}
        </motion.p>
      ) : (
        <p className="text-3xl font-black" style={{ color: 'var(--ff-text-3)' }}>?</p>
      )}
    </motion.div>
  );
}

export default function PriceGuesser() {
  useSeo(getRouteMeta('/price-guesser'));
  const { showToast } = useToast();
  const [current, setCurrent] = useState<GuesserItem | null>(null);
  const [next, setNext] = useState<GuesserItem | null>(null);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [result, setResult] = useState<'correct' | 'wrong' | null>(null);
  const [gameOver, setGameOver] = useState(false);

  const startGame = useCallback(() => {
    const [a, b] = pickStartingPair();
    setCurrent(a);
    setNext(b);
    setScore(0);
    setRevealed(false);
    setResult(null);
    setGameOver(false);
  }, []);

  useEffect(() => {
    setBest(readBest());
    startGame();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const guess = (direction: 'higher' | 'lower') => {
    if (!current || !next || revealed) return;
    const actual = next.price > current.price ? 'higher' : 'lower';
    const isCorrect = direction === actual;
    setRevealed(true);
    setResult(isCorrect ? 'correct' : 'wrong');

    if (isCorrect) {
      const newScore = score + 1;
      setTimeout(() => {
        setScore(newScore);
        if (newScore > best) {
          setBest(newScore);
          try { localStorage.setItem(BEST_KEY, String(newScore)); } catch { /* ignore */ }
        }
        const upcoming = pickNextItem([current.price, next.price], [current.id, next.id]);
        setCurrent(next);
        setNext(upcoming);
        setRevealed(false);
        setResult(null);
      }, 1100);
    } else {
      setTimeout(() => setGameOver(true), 1100);
    }
  };

  const shareScore = async () => {
    const url = `${SITE_URL}/price-guesser`;
    const title = `I scored ${score} in a row on SpecSmith's Higher or Lower price game — can you beat it?`;
    if (typeof navigator.share === 'function') {
      try {
        await navigator.share({ title, url });
        return;
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return;
      }
    }
    try {
      await navigator.clipboard.writeText(`${title} ${url}`);
      showToast('Copied to clipboard', 'success');
    } catch {
      showToast('Failed to copy', 'error');
    }
  };

  if (!current || !next) return null;

  return (
    <div className="relative min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(guesserFaqJsonLd) }} />
      <PageGlow variant="warm" />
      <div className="relative max-w-3xl mx-auto px-4 sm:px-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8">
          <h1 className="text-4xl sm:text-5xl font-black mb-4" style={{ color: 'var(--ff-text)' }}>
            Higher or <span className="gradient-text">Lower?</span>
          </h1>
          <p className="text-lg max-w-xl mx-auto" style={{ color: 'var(--ff-text-2)' }}>
            Guess whether the next GPU or CPU costs more or less than the one shown — using the same street prices from our Builder.
          </p>
        </motion.div>

        <div className="flex items-center justify-center gap-6 mb-8">
          <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--ff-text)' }}>
            Score: <span className="text-lg font-black">{score}</span>
          </div>
          <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: 'var(--ff-amber)' }}>
            <Trophy size={16} /> Best: {best}
          </div>
        </div>

        {gameOver ? (
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="rounded-2xl p-10 text-center"
            style={{ backgroundColor: 'var(--ff-surface)', border: '1px solid var(--ff-border)' }}
          >
            <p className="text-sm uppercase tracking-wider mb-2" style={{ color: 'var(--ff-text-3)' }}>Game Over</p>
            <p className="text-4xl font-black mb-2" style={{ color: 'var(--ff-text)' }}>{score} correct</p>
            <p className="text-sm mb-6" style={{ color: 'var(--ff-text-2)' }}>
              {next.name} — ${next.price.toLocaleString()} was {next.price > current.price ? 'higher' : 'lower'} than {current.name} at ${current.price.toLocaleString()}.
            </p>
            <div className="flex items-center justify-center gap-3 flex-wrap">
              <button
                onClick={startGame}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white"
                style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}
              >
                <RotateCcw size={16} /> Play Again
              </button>
              <button
                onClick={shareScore}
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-bold text-sm"
                style={{ backgroundColor: 'var(--ff-card)', color: 'var(--ff-text)', border: '1px solid var(--ff-border)' }}
              >
                <Share2 size={16} /> Share Score
              </button>
            </div>
          </motion.div>
        ) : (
          <>
            <div className="flex flex-col sm:flex-row gap-4 mb-6">
              <ItemCard item={current} revealPrice />
              <div className="flex sm:flex-col items-center justify-center gap-1 text-2xl font-black flex-shrink-0" style={{ color: 'var(--ff-text-3)' }}>
                VS
              </div>
              <AnimatePresence mode="wait">
                <ItemCard
                  key={next.id}
                  item={next}
                  revealPrice={revealed}
                  highlight={revealed ? (result ?? undefined) : undefined}
                />
              </AnimatePresence>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => guess('higher')}
                disabled={revealed}
                className="flex items-center justify-center gap-2 py-4 rounded-xl font-bold text-sm disabled:opacity-50"
                style={{ backgroundColor: 'var(--ff-card)', color: 'var(--ff-text)', border: '1px solid var(--ff-border)' }}
              >
                <ArrowUp size={18} style={{ color: 'var(--ff-green)' }} /> Higher
              </button>
              <button
                onClick={() => guess('lower')}
                disabled={revealed}
                className="flex items-center justify-center gap-2 py-4 rounded-xl font-bold text-sm disabled:opacity-50"
                style={{ backgroundColor: 'var(--ff-card)', color: 'var(--ff-text)', border: '1px solid var(--ff-border)' }}
              >
                <ArrowDown size={18} style={{ color: 'var(--ff-red)' }} /> Lower
              </button>
            </div>
          </>
        )}

        <div className="text-center mt-8 mb-4">
          <Link to="/builder" className="inline-flex items-center gap-1 text-xs font-semibold hover:opacity-80" style={{ color: 'var(--ff-accent-text)' }}>
            <Cpu size={12} /> See real prices for every part in the Builder →
          </Link>
        </div>

        <div className="mt-8 space-y-3">
          {guesserFaqSections.map((s) => (
            <div key={s.title} className="rounded-xl p-4" style={{ border: '1px solid var(--ff-border)', backgroundColor: 'var(--ff-surface)' }}>
              <h2 className="font-bold text-sm mb-1.5" style={{ color: 'var(--ff-text)' }}>{s.title}</h2>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>{s.content}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
