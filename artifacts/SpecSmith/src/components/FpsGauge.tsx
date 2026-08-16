import { useEffect, useState, useRef } from 'react';
import { motion } from 'framer-motion';

interface FpsGaugeProps {
  fps: number;
  min: number;
  max: number;
  color: string;
  label: string;
}

export default function FpsGauge({ fps, min, max, color, label }: FpsGaugeProps) {
  const [displayFps, setDisplayFps] = useState(0);
  const animRef = useRef<number | null>(null);
  const startTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    startTimeRef.current = null;
    const duration = 800;
    const startVal = 0;
    const endVal = fps;

    const animate = (timestamp: number) => {
      if (!startTimeRef.current) startTimeRef.current = timestamp;
      const elapsed = timestamp - startTimeRef.current;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplayFps(Math.round(startVal + (endVal - startVal) * eased));
      if (progress < 1) {
        animRef.current = requestAnimationFrame(animate);
      }
    };

    animRef.current = requestAnimationFrame(animate);
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [fps]);

  // Semicircle gauge: 0 to 999 fps -> 0 to 180 degrees
  const maxFps = 999;
  const angleDeg = Math.min((fps / maxFps) * 180, 180);
  const angleRad = (angleDeg - 180) * (Math.PI / 180);
  const cx = 100;
  const cy = 100;
  const r = 72;
  const needleX = cx + r * Math.cos(angleRad);
  const needleY = cy + r * Math.sin(angleRad);

  return (
    <div className="flex flex-col items-center">
      <div className="relative" style={{ width: 200, height: 120 }}>
        <svg width="200" height="120" viewBox="0 0 200 120">
          {/* Background arc */}
          <path
            d="M 28 100 A 72 72 0 0 1 172 100"
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="14"
            strokeLinecap="round"
          />
          {/* Color arc - animate width */}
          <motion.path
            d="M 28 100 A 72 72 0 0 1 172 100"
            fill="none"
            stroke={color}
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray="226.2"
            initial={{ strokeDashoffset: 226.2 }}
            animate={{ strokeDashoffset: 226.2 - (226.2 * angleDeg / 180) }}
            transition={{ duration: 0.8, ease: [0, 0, 0.2, 1] }}
          />
          {/* Needle */}
          <motion.line
            x1={cx}
            y1={cy}
            x2={needleX}
            y2={needleY}
            stroke={color}
            strokeWidth="3"
            strokeLinecap="round"
            initial={{ x2: 28, y2: 100 }}
            animate={{ x2: needleX, y2: needleY }}
            transition={{ duration: 0.8, ease: [0, 0, 0.2, 1] }}
          />
          {/* Center dot */}
          <circle cx={cx} cy={cy} r="5" fill={color} />
          {/* Labels */}
          <text x="25" y="118" fill="rgba(255,255,255,0.3)" fontSize="10" textAnchor="middle">0</text>
          <text x="175" y="118" fill="rgba(255,255,255,0.3)" fontSize="10" textAnchor="middle">999</text>
        </svg>
        {/* Center FPS display */}
        <div className="absolute inset-0 flex flex-col items-center justify-end pb-2">
          <span className="text-4xl font-black tabular-nums" style={{ color }}>
            {displayFps}
          </span>
          <span className="text-xs text-[var(--ff-text-2)] font-medium uppercase tracking-widest">FPS</span>
        </div>
      </div>
      <div className="mt-1 text-center">
        <span className="text-sm font-semibold px-3 py-1 rounded-full text-xs" style={{ color, backgroundColor: `${color}18` }}>
          {label}
        </span>
        <p className="text-[var(--ff-text-2)] text-xs mt-2">
          Range: <span style={{ color }}>{min} — {max} FPS estimated</span>
        </p>
      </div>
    </div>
  );
}
