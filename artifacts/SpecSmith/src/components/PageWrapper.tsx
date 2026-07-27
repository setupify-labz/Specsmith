import { useLocation } from 'react-router-dom';
import { AnimatePresence, motion } from 'framer-motion';

export default function PageWrapper({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  return (
    <AnimatePresence mode="wait">
      <motion.main
        key={location.pathname}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.15 }}
      >
        {children}
      </motion.main>
    </AnimatePresence>
  );
}
