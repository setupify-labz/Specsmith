import { createContext, useContext, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle, AlertCircle, XCircle, Info, X } from 'lucide-react';

export type ToastType = 'success' | 'warning' | 'error' | 'info';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  action?: { label: string; onClick: () => void };
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType, action?: Toast['action']) => void;
}

const ToastContext = createContext<ToastContextType>({ showToast: () => {} });

const COLORS: Record<ToastType, string> = {
  success: '#00E676',
  warning: '#FFB300',
  error:   '#FF1744',
  info:    '#9B94FF',
};

const ICONS: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle size={18} />,
  warning: <AlertCircle size={18} />,
  error:   <XCircle size={18} />,
  info:    <Info size={18} />,
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: ToastType = 'success', action?: Toast['action']) => {
    const id = Date.now().toString();
    setToasts(prev => [...prev.slice(-2), { id, message, type, action }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 4000);
  }, []);

  const dismiss = (id: string) => setToasts(prev => prev.filter(t => t.id !== id));

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-6 right-6 z-[200] flex flex-col gap-3 pointer-events-none">
        <AnimatePresence>
          {toasts.map(toast => (
            <motion.div
              key={toast.id}
              initial={{ x: 120, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={{ x: 120, opacity: 0 }}
              transition={{ duration: 0.3, ease: 'easeOut' }}
              className="pointer-events-auto w-80 rounded-xl p-4 shadow-2xl flex items-start gap-3"
              style={{
                backgroundColor: 'var(--ff-surface)',
                borderLeft: `4px solid ${COLORS[toast.type]}`,
                color: 'var(--ff-text)',
              }}
            >
              <span style={{ color: COLORS[toast.type], flexShrink: 0, marginTop: 1 }}>
                {ICONS[toast.type]}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium leading-snug" style={{ color: 'var(--ff-text)' }}>{toast.message}</p>
                {toast.action && (
                  <button
                    onClick={toast.action.onClick}
                    className="mt-1 text-xs font-semibold"
                    style={{ color: COLORS[toast.type] }}
                  >
                    {toast.action.label} →
                  </button>
                )}
              </div>
              <button
                onClick={() => dismiss(toast.id)}
                aria-label="Dismiss notification"
                className="flex-shrink-0 p-0.5 rounded hover:opacity-60 transition-opacity"
                style={{ color: 'var(--ff-text-3)' }}
              >
                <X size={14} />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}
