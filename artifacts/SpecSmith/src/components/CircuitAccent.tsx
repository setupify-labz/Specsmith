/** Decorative circuit-trace lines echoing the Anvil Chip logo's motif.
 * Purely visual, very low opacity, ignored by assistive tech. */
export default function CircuitAccent({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1200 300"
      preserveAspectRatio="none"
      aria-hidden="true"
      className={className}
      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
    >
      <g fill="none" stroke="var(--ff-accent)" strokeWidth="1.5" opacity="0.14" strokeLinecap="round">
        <path d="M0 60 H180 L220 100 V220" />
        <path d="M120 60 V20 H320" />
        <path d="M1200 90 H1000 L960 130 V260" />
        <path d="M1080 90 V30 H900" />
        <path d="M0 220 H140 L170 250 H400" />
      </g>
      <g fill="var(--ff-cyan)" opacity="0.22">
        <circle cx="220" cy="220" r="3.5" />
        <circle cx="320" cy="20" r="3.5" />
        <circle cx="960" cy="260" r="3.5" />
        <circle cx="900" cy="30" r="3.5" />
        <circle cx="400" cy="250" r="3.5" />
      </g>
    </svg>
  );
}
