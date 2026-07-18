// SpecSmith logo — the neon anvil-dock mark. logo-32.png is a 128x128
// downscale of the full logo.png master (which stays at 512x512 for
// favicons/share-cards/OG image) — Navbar and Footer only ever render this
// at 32 CSS px, so shipping the master here was a ~190KB wasted download on
// every single page load.
export default function Logo({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <img
      src="/logo-32.png"
      alt="SpecSmith logo"
      width={size}
      height={size}
      className={className}
      style={{ objectFit: 'cover', borderRadius: size * 0.22 }}
    />
  );
}
