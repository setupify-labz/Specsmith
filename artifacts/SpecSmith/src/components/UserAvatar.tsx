import { useId } from 'react';
import { getAvatarPersona, type EyeStyle, type MouthStyle, type AccessoryStyle } from '../lib/avatars';

interface Props {
  username: string;
  avatar?: string | null;
  size?: number;
  className?: string;
}

const INK = '#14141F';

function Eyes({ style, glowColor }: { style: EyeStyle; glowColor: string }) {
  switch (style) {
    case 'excited':
      return (
        <>
          <path d="M28 30 L38 33" stroke={INK} strokeWidth="2.5" strokeLinecap="round" />
          <path d="M72 30 L62 33" stroke={INK} strokeWidth="2.5" strokeLinecap="round" />
          <ellipse cx="36" cy="45" rx="9" ry="11" fill="white" />
          <ellipse cx="64" cy="45" rx="9" ry="11" fill="white" />
          <circle cx="37" cy="46" r="5" fill={INK} />
          <circle cx="65" cy="46" r="5" fill={INK} />
          <circle cx="39.5" cy="42.5" r="1.6" fill="white" />
          <circle cx="67.5" cy="42.5" r="1.6" fill="white" />
        </>
      );
    case 'glow':
      return (
        <>
          <ellipse cx="36" cy="45" rx="11" ry="7" fill={glowColor} opacity="0.4" />
          <ellipse cx="64" cy="45" rx="11" ry="7" fill={glowColor} opacity="0.4" />
          <ellipse cx="36" cy="45" rx="6.5" ry="4" fill={glowColor} />
          <ellipse cx="64" cy="45" rx="6.5" ry="4" fill={glowColor} />
          <ellipse cx="36" cy="45" rx="2.5" ry="1.6" fill="white" />
          <ellipse cx="64" cy="45" rx="2.5" ry="1.6" fill="white" />
        </>
      );
    case 'shades':
      return (
        <>
          <rect x="24" y="39" width="52" height="13" rx="6.5" fill={INK} />
          <path d="M24 45.5 H76" stroke={INK} strokeWidth="2" />
          <path d="M30 43 Q36 41 42 43" stroke="rgba(255,255,255,0.35)" strokeWidth="2" fill="none" strokeLinecap="round" />
          <path d="M58 43 Q64 41 70 43" stroke="rgba(255,255,255,0.35)" strokeWidth="2" fill="none" strokeLinecap="round" />
        </>
      );
    case 'wink':
      return (
        <>
          <ellipse cx="36" cy="45" rx="8" ry="10" fill="white" />
          <circle cx="37" cy="46" r="4.5" fill={INK} />
          <circle cx="39" cy="42.5" r="1.4" fill="white" />
          <path d="M58 46 Q64 41 70 46" stroke={INK} strokeWidth="2.5" fill="none" strokeLinecap="round" />
        </>
      );
    case 'sleepy':
      return (
        <>
          <path d="M28 46 Q36 41 44 46" stroke={INK} strokeWidth="2.5" fill="none" strokeLinecap="round" />
          <path d="M56 46 Q64 41 72 46" stroke={INK} strokeWidth="2.5" fill="none" strokeLinecap="round" />
        </>
      );
    case 'normal':
    default:
      return (
        <>
          <ellipse cx="36" cy="45" rx="8" ry="10" fill="white" />
          <ellipse cx="64" cy="45" rx="8" ry="10" fill="white" />
          <circle cx="37" cy="46" r="4.5" fill={INK} />
          <circle cx="65" cy="46" r="4.5" fill={INK} />
          <circle cx="39" cy="42.5" r="1.4" fill="white" />
          <circle cx="67" cy="42.5" r="1.4" fill="white" />
        </>
      );
  }
}

function Mouth({ style }: { style: MouthStyle }) {
  switch (style) {
    case 'grin':
      return (
        <>
          <path d="M34 62 Q50 78 66 62 Z" fill={INK} />
          <path d="M40 64 Q50 70 60 64 Z" fill="white" />
        </>
      );
    case 'smirk':
      return (
        <>
          <path d="M38 64 Q52 70 62 60" stroke="rgba(255,255,255,0.6)" strokeWidth="5" fill="none" strokeLinecap="round" />
          <path d="M38 64 Q52 70 62 60" stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round" />
        </>
      );
    case 'flat':
      return <path d="M40 64 H60" stroke={INK} strokeWidth="3" strokeLinecap="round" />;
    case 'open':
      return <ellipse cx="50" cy="66" rx="8" ry="7" fill={INK} />;
    case 'smile':
    default:
      return <path d="M36 61 Q50 74 64 61" stroke={INK} strokeWidth="3" fill="none" strokeLinecap="round" />;
  }
}

function Accessory({ style, accent }: { style: AccessoryStyle; accent: string }) {
  switch (style) {
    case 'crown':
      return (
        <path
          d="M22 24 L30 8 L40 20 L50 4 L60 20 L70 8 L78 24 L78 30 L22 30 Z"
          fill="#FFD700" stroke="#FF8C00" strokeWidth="1.5" strokeLinejoin="round"
        />
      );
    case 'hood':
      return (
        <path
          d="M4 30 Q50 -18 96 30 L96 34 Q50 6 4 34 Z"
          fill="rgba(0,0,0,0.6)"
        />
      );
    case 'mohawk':
      return (
        <path
          d="M32 22 L38 2 L44 20 L50 -2 L56 20 L62 2 L68 22"
          stroke={INK} strokeWidth="6" fill="none" strokeLinecap="round" strokeLinejoin="round"
        />
      );
    case 'none':
    default:
      return null;
  }
}

// Renders the user's chosen PC-part persona as a small cartoon face badge,
// falling back to their first initial on a plain accent gradient when no
// avatar is set.
export default function UserAvatar({ username, avatar, size = 28, className }: Props) {
  const gradId = useId();
  const persona = getAvatarPersona(avatar);

  if (!persona) {
    return (
      <div
        className={`rounded-full flex items-center justify-center flex-shrink-0 ${className ?? ''}`}
        style={{ width: size, height: size, background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))' }}
      >
        <span className="font-bold text-white" style={{ fontSize: size * 0.42 }}>{username[0]?.toUpperCase()}</span>
      </div>
    );
  }

  return (
    <div
      className={`relative rounded-full flex-shrink-0 overflow-visible ${className ?? ''}`}
      style={{ width: size, height: size }}
      title={persona.name}
    >
      <svg viewBox="0 0 100 100" width={size} height={size} style={{ overflow: 'visible' }}>
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={persona.gradient[0]} />
            <stop offset="100%" stopColor={persona.gradient[1]} />
          </linearGradient>
          <clipPath id={`${gradId}-clip`}>
            <circle cx="50" cy="50" r="50" />
          </clipPath>
        </defs>
        <circle cx="50" cy="50" r="50" fill={`url(#${gradId})`} />
        <g clipPath={`url(#${gradId}-clip)`}>
          <Accessory style={persona.accessory} accent={persona.gradient[0]} />
        </g>
        <Eyes style={persona.eyes} glowColor={persona.eyes === 'glow' ? (persona.id === 'mainframe-overlord' ? '#D8B3FF' : '#FFD1D1') : '#fff'} />
        <Mouth style={persona.mouth} />
      </svg>
    </div>
  );
}
