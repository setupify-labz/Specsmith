import { useEffect, useRef, useState } from 'react';
import { Boxes } from 'lucide-react';
import { createBuild3dScene, type Build3dScene, type Build3dParts } from '../lib/build3dScene';

interface Build3DProps {
  parts: Build3dParts;
  /** Tailwind height class for the viewport (default h-72). */
  heightClass?: string;
}

// Default export so Builder can React.lazy() this — three.js only downloads
// on the Builder page, after hydration, never in the prerendered HTML path.
export default function Build3D({ parts, heightClass = 'h-72' }: Build3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<Build3dScene | null>(null);
  const [webglFailed, setWebglFailed] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const scene = createBuild3dScene(containerRef.current);
    if (!scene) {
      setWebglFailed(true);
      return;
    }
    sceneRef.current = scene;
    return () => {
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setParts(parts);
  }, [parts]);

  const empty =
    !parts.gpu && !parts.cpu && !parts.motherboard && !parts.ram &&
    !parts.storage && !parts.psu && !parts.case && !parts.cooler;

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ border: '1px solid var(--ff-border)', backgroundColor: 'var(--ff-surface)' }}
    >
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <div className="flex items-center gap-2">
          <Boxes size={16} style={{ color: 'var(--ff-accent-text)' }} aria-hidden="true" />
          <h2 className="text-sm font-bold" style={{ color: 'var(--ff-text)' }}>3D Preview</h2>
        </div>
        {!webglFailed && (
          <span className="text-xs" style={{ color: 'var(--ff-text-2)' }}>Drag to rotate</span>
        )}
      </div>
      <div className="relative mx-3 mb-3 rounded-xl overflow-hidden">
        {webglFailed ? (
          <div
            className={`${heightClass} flex items-center justify-center px-6 text-center text-sm`}
            style={{ backgroundColor: 'var(--ff-card)', color: 'var(--ff-text-2)' }}
          >
            3D preview isn't supported in this browser.
          </div>
        ) : (
          <>
            <div
              ref={containerRef}
              className={`${heightClass} cursor-grab active:cursor-grabbing`}
              role="img"
              aria-label="Stylized 3D preview of your selected PC parts"
              // The scene renders its own opaque dark backdrop (bloom needs
              // one); this CSS backdrop just prevents a flash before the
              // first frame, in both site themes.
              style={{ background: '#0b0c15' }}
            />
            {empty && (
              <div className="absolute inset-x-0 bottom-4 text-center pointer-events-none">
                <span className="text-xs" style={{ color: '#8888AA' }}>
                  Select parts to watch your rig assemble
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
