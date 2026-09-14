// A 64px WebP gives 2x density at the only rendered size (32px) without
// making every page download the 512px source artwork.
export default function Logo({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <img
      src="/logo-64.webp"
      alt="SpecSmith logo"
      width={size}
      height={size}
      className={className}
      style={{ objectFit: 'cover', borderRadius: size * 0.22 }}
    />
  );
}
