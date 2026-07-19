import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Home, Cpu } from 'lucide-react';
import { useSeo } from '../hooks/useSeo';
import PageGlow from '../components/PageGlow';

export default function NotFound() {
  useSeo({
    path: '/404',
    title: 'Page Not Found | SpecSmith',
    description: 'This page could not be found. Head back to the SpecSmith PC Builder to keep planning your build.',
    noindex: true,
  });

  return (
    <div className="relative min-h-screen pt-24 pb-20 flex items-center justify-center px-4" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <PageGlow variant="danger" />
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="relative text-center max-w-md">
        <div className="text-7xl font-black gradient-text mb-4">404</div>
        <h1 className="text-2xl font-black mb-2" style={{ color: 'var(--ff-text)' }}>Page Not Found</h1>
        <p className="text-sm mb-8" style={{ color: 'var(--ff-text-2)' }}>
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <Link
            to="/"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm text-white transition-all hover:opacity-90"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}
          >
            <Home size={15} /> Back to Home
          </Link>
          <Link
            to="/builder"
            className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl font-bold text-sm transition-all hover:opacity-90"
            style={{ border: '1px solid var(--ff-border)', color: 'var(--ff-text)' }}
          >
            <Cpu size={15} /> Open the Builder
          </Link>
        </div>
      </motion.div>
    </div>
  );
}
