const VARIANTS: Record<string, [string, string]> = {
  default: ['#6C63FF', '#00D4FF'],
  warm: ['#FFB300', '#FF6EC7'],
  cool: ['#00E676', '#00D4FF'],
  danger: ['#FF6EC7', '#6C63FF'],
};

/** Two soft blurred color orbs behind a page's header — the same subtle
 * accent treatment the homepage hero uses, reused across pages that were
 * otherwise a flat background with no visual interest. Purely decorative. */
export default function PageGlow({ variant = 'default' }: { variant?: keyof typeof VARIANTS }) {
  const [a, b] = VARIANTS[variant];
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      <div className="absolute -top-16 left-1/4 w-72 h-72 rounded-full blur-3xl" style={{ backgroundColor: a, opacity: 0.09 }} />
      <div className="absolute top-32 right-1/4 w-72 h-72 rounded-full blur-3xl" style={{ backgroundColor: b, opacity: 0.07 }} />
    </div>
  );
}
