import { getAvatarPersona } from '../lib/avatars';

interface Props {
  username: string;
  avatar?: string | null;
  size?: number;
  className?: string;
}

// Renders the user's chosen PC-part persona badge, falling back to their
// first initial on a plain accent gradient when no avatar is set.
export default function UserAvatar({ username, avatar, size = 28, className }: Props) {
  const persona = getAvatarPersona(avatar);
  const Icon = persona?.icon;

  return (
    <div
      className={`rounded-full flex items-center justify-center flex-shrink-0 ${className ?? ''}`}
      style={{
        width: size,
        height: size,
        background: persona
          ? `linear-gradient(135deg, ${persona.gradient[0]}, ${persona.gradient[1]})`
          : 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))',
      }}
      title={persona?.name}
    >
      {Icon
        ? <Icon size={Math.round(size * 0.55)} className="text-white" strokeWidth={2.25} />
        : <span className="font-bold text-white" style={{ fontSize: size * 0.42 }}>{username[0]?.toUpperCase()}</span>}
    </div>
  );
}
