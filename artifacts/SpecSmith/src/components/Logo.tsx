import { useId } from 'react';

// The Anvil Chip v2 — a smith's anvil standing on a CPU package (dark
// casing, light substrate, pins on three sides), spark overhead. Gradient
// follows the theme accent vars so it adapts to light/dark mode.
export default function Logo({ size = 32, className }: { size?: number; className?: string }) {
  const gid = useId();
  const pid = `${gid}-pin`;
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="10" y1="12" x2="52" y2="34" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--ff-accent)" />
          <stop offset="1" stopColor="var(--ff-cyan)" />
        </linearGradient>
        <linearGradient id={pid} x1="14" y1="32" x2="50" y2="50" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4E8FF7" />
          <stop offset="1" stopColor="var(--ff-cyan)" />
        </linearGradient>
      </defs>
      <polygon points="32,1.5 33.6,5.8 38,7.5 33.6,9.2 32,13.5 30.4,9.2 26,7.5 30.4,5.8" fill="var(--ff-cyan)" />
      <g transform="translate(7.4 1) scale(0.75)">
        <path d="M11 16 H38 C46 16 53.5 16.5 57.5 19.5 C55.5 24.5 47 28.5 40 30 H11 Q8 30 8 27 V19 Q8 16 11 16 Z" fill={`url(#${gid})`} />
        <path d="M22 30 H40 C38.5 33.5 37 36.5 37 40 H27 C27 36.5 25.5 33.5 22 30 Z" fill={`url(#${gid})`} />
      </g>
      <rect x="9.5" y="33.5" width="4" height="3" rx="1" fill={`url(#${pid})`} />
      <rect x="9.5" y="38" width="4" height="3" rx="1" fill={`url(#${pid})`} />
      <rect x="9.5" y="42.5" width="4" height="3" rx="1" fill={`url(#${pid})`} />
      <rect x="50.5" y="33.5" width="4" height="3" rx="1" fill={`url(#${pid})`} />
      <rect x="50.5" y="38" width="4" height="3" rx="1" fill={`url(#${pid})`} />
      <rect x="50.5" y="42.5" width="4" height="3" rx="1" fill={`url(#${pid})`} />
      <rect x="13.5" y="31" width="37" height="17" rx="3" fill="#223052" />
      <rect x="17.5" y="34.5" width="29" height="10" rx="2" fill="#E8ECF2" />
      <rect x="26.6" y="31" width="10.8" height="6.5" fill={`url(#${gid})`} />
      <rect x="17" y="48" width="4" height="6" rx="1.2" fill={`url(#${pid})`} />
      <rect x="24.6" y="48" width="4" height="6" rx="1.2" fill={`url(#${pid})`} />
      <rect x="32.2" y="48" width="4" height="6" rx="1.2" fill={`url(#${pid})`} />
      <rect x="39.8" y="48" width="4" height="6" rx="1.2" fill={`url(#${pid})`} />
      <rect x="47" y="48" width="4" height="6" rx="1.2" fill={`url(#${pid})`} />
    </svg>
  );
}
