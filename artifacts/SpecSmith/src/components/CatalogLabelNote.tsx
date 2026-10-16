import { catalogLabelText } from '../lib/catalogLifecycle';

/**
 * The catalog audit's label for a part ("Older generation", ...), shown next
 * to a recommended part so a shopper knows when a pick is not current
 * hardware. Renders nothing for current parts.
 */
export default function CatalogLabelNote({ id, className = '' }: { id: string; className?: string }) {
  const text = catalogLabelText(id);
  if (!text) return null;
  return (
    <span className={`block text-[11px] font-semibold ${className}`} style={{ color: 'var(--ff-text-2)' }}>
      {text}
    </span>
  );
}
