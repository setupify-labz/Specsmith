import { useId } from 'react';

// The Anvil Chip — SpecSmith's mark: a smith's anvil forged onto a microchip.
// Gradient follows the theme accent vars; the etched trace uses the page
// background so it reads as cut into the metal on any surface.
export default function Logo({ size = 32, className }: { size?: number; className?: string }) {
  const gid = useId();
  return (
    <svg viewBox="0 0 64 64" width={size} height={size} className={className} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="10" y1="12" x2="56" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="var(--ff-accent)" />
          <stop offset="1" stopColor="var(--ff-cyan)" />
        </linearGradient>
      </defs>
      <polygon points="24,3 25.8,7.6 30.5,9.5 25.8,11.4 24,16 22.2,11.4 17.5,9.5 22.2,7.6" fill="var(--ff-cyan)" />
      <circle cx="34" cy="6" r="1.8" fill="var(--ff-cyan)" opacity="0.85" />
      <path d="M11 16 H38 C46 16 53.5 16.5 57.5 19.5 C55.5 24.5 47 28.5 40 30 H11 Q8 30 8 27 V19 Q8 16 11 16 Z" fill={`url(#${gid})`} />
      <path d="M22 30 H40 C38.5 33.5 37 36.5 37 40 H27 C27 36.5 25.5 33.5 22 30 Z" fill={`url(#${gid})`} />
      <rect x="13" y="40" width="38" height="13" rx="3" fill={`url(#${gid})`} />
      <rect x="17" y="53" width="5" height="6" rx="1.2" fill={`url(#${gid})`} />
      <rect x="26.3" y="53" width="5" height="6" rx="1.2" fill={`url(#${gid})`} />
      <rect x="35.6" y="53" width="5" height="6" rx="1.2" fill={`url(#${gid})`} />
      <rect x="45" y="53" width="5" height="6" rx="1.2" fill={`url(#${gid})`} />
      <line x1="19" y1="46.5" x2="34" y2="46.5" stroke="var(--ff-bg)" strokeWidth="2.2" strokeLinecap="round" opacity="0.55" />
      <circle cx="38.5" cy="46.5" r="2.1" fill="none" stroke="var(--ff-bg)" strokeWidth="2.2" opacity="0.55" />
    </svg>
  );
}
