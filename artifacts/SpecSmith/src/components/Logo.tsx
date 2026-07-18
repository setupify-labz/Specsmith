// SpecSmith logo — the neon anvil-dock mark (public/logo.png, tight-cropped
// from the original artwork). The image has its own dark background, so it's
// rendered as a rounded tile that reads as an app icon on light or dark.
export default function Logo({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <img
      src="/logo.png"
      alt="SpecSmith logo"
      width={size}
      height={size}
      className={className}
      style={{ objectFit: 'cover', borderRadius: size * 0.22 }}
    />
  );
}
