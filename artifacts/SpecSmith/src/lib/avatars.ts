import {
  Cpu, Gpu, MemoryStick, Zap, CircuitBoard, Power, Snowflake, Shield, Wind, Sparkles,
  type LucideIcon,
} from 'lucide-react';

export type EyeStyle = 'normal' | 'glow' | 'shades' | 'wink' | 'sleepy' | 'excited';
export type MouthStyle = 'smile' | 'smirk' | 'grin' | 'flat' | 'open';
export type AccessoryStyle = 'crown' | 'hood' | 'mohawk' | 'none';

export interface AvatarPersona {
  id: string;
  name: string;
  tagline: string;
  icon: LucideIcon;
  gradient: [string, string];
  eyes: EyeStyle;
  mouth: MouthStyle;
  accessory: AccessoryStyle;
}

// A PC-parts-themed avatar set — one persona per major component category,
// picked in Settings and shown wherever a signed-in user's avatar appears.
// Each gets a cartoon face (drawn in UserAvatar.tsx) plus a signature
// accessory so they read as characters, not just an icon on a circle.
export const AVATAR_PERSONAS: AvatarPersona[] = [
  { id: 'core-commander',     name: 'Core Commander',     tagline: 'Think. Calculate. Dominate.',   icon: Cpu,          gradient: ['#00D4FF', '#6C63FF'], eyes: 'normal',  mouth: 'smile', accessory: 'crown' },
  { id: 'pixel-reaper',       name: 'Pixel Reaper',       tagline: "Frames don't fear me.",         icon: Gpu,          gradient: ['#FF1744', '#8C0000'], eyes: 'glow',    mouth: 'smirk', accessory: 'hood'  },
  { id: 'memory-maverick',    name: 'Memory Maverick',    tagline: 'Speed. Multiplied.',             icon: MemoryStick,  gradient: ['#00E676', '#00A854'], eyes: 'shades',  mouth: 'grin',  accessory: 'none'  },
  { id: 'nitro-blade',        name: 'Nitro Blade',        tagline: 'Small size. Insane speed.',      icon: Zap,          gradient: ['#00D4FF', '#0099CC'], eyes: 'excited', mouth: 'open',  accessory: 'none'  },
  { id: 'mainframe-overlord', name: 'Mainframe Overlord', tagline: 'I connect everything.',          icon: CircuitBoard, gradient: ['#6C63FF', '#3D1D8C'], eyes: 'glow',    mouth: 'smirk', accessory: 'crown' },
  { id: 'power-punk',         name: 'Power Punk',         tagline: 'No power, no glory.',            icon: Power,        gradient: ['#FFB300', '#FF8C00'], eyes: 'shades',  mouth: 'grin',  accessory: 'mohawk' },
  { id: 'frostbite',          name: 'Frostbite',          tagline: 'Chill under pressure.',          icon: Snowflake,    gradient: ['#00D4FF', '#5AC8FA'], eyes: 'sleepy',  mouth: 'flat',  accessory: 'none'  },
  { id: 'the-stronghold',     name: 'The Stronghold',     tagline: 'Built to protect.',              icon: Shield,       gradient: ['#6C63FF', '#9C63FF'], eyes: 'normal',  mouth: 'smile', accessory: 'none'  },
  { id: 'windwalker',         name: 'Windwalker',         tagline: 'Keep it cool. Keep it moving.',  icon: Wind,         gradient: ['#00E676', '#00BFA5'], eyes: 'wink',    mouth: 'smile', accessory: 'none'  },
  { id: 'chroma-chameleon',   name: 'Chroma Chameleon',   tagline: 'Adapt. Glow. Impress.',          icon: Sparkles,     gradient: ['#FF3D9A', '#6C63FF'], eyes: 'shades',  mouth: 'open',  accessory: 'none'  },
];

export function getAvatarPersona(id: string | undefined | null): AvatarPersona | undefined {
  return AVATAR_PERSONAS.find(p => p.id === id);
}
