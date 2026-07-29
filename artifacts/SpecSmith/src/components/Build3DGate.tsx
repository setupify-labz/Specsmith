import { useState, type ReactNode } from 'react';
import { Boxes, WifiOff } from 'lucide-react';
import { isDataSaverOn } from '../lib/dataSaver';

interface Build3DGateProps {
  /** The actual <Suspense><Build3D .../></Suspense> tree — not rendered (and
   * so not lazy-imported) at all while Data Saver blocks it. */
  children: ReactNode;
  heightClass?: string;
}

// Sits above Build3D's lazy import point. React only triggers a lazy
// component's dynamic import() once it actually attempts to render that
// element — an element built into `children` by the caller is inert until
// something mounts it — so holding off on rendering `children` here means
// three.js (~176KB gzip) genuinely never downloads while blocked, not just
// the GLB models.
export default function Build3DGate({ children, heightClass = 'h-72' }: Build3DGateProps) {
  const [blocked, setBlocked] = useState(isDataSaverOn);

  if (!blocked) return <>{children}</>;

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ border: '1px solid var(--ff-border)', backgroundColor: 'var(--ff-surface)' }}
    >
      <div className="flex items-center gap-2 px-4 pt-4 pb-3">
        <Boxes size={16} style={{ color: 'var(--ff-accent-text)' }} aria-hidden="true" />
        <h2 className="text-sm font-bold" style={{ color: 'var(--ff-text)' }}>3D Preview</h2>
      </div>
      <div
        className={`${heightClass} mx-3 mb-3 rounded-xl flex flex-col items-center justify-center gap-3 px-6 text-center`}
        style={{ backgroundColor: 'var(--ff-card)' }}
      >
        <WifiOff size={20} style={{ color: 'var(--ff-text-2)' }} aria-hidden="true" />
        <p className="text-sm" style={{ color: 'var(--ff-text-2)' }}>
          Data Saver is on — the 3D preview loads extra images to show your build.
        </p>
        <button
          onClick={() => setBlocked(false)}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg transition-all hover:opacity-90"
          style={{ border: '1px solid var(--ff-accent)', color: 'var(--ff-accent-text)' }}
        >
          Show 3D preview anyway
        </button>
      </div>
    </div>
  );
}
