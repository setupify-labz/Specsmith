export default function Logo({ size = 32, className }: { size?: number; className?: string }) {
  return (
    <img
      src="/logo.png"
      alt="SpecSmith logo"
      width={size}
      height={size}
      className={className}
      style={{ objectFit: 'contain' }}
    />
  );
}
