import { ExternalLink, Search } from 'lucide-react';
import type { RetailerLink } from '../lib/retailerLinkState';

interface Props {
  retailer: 'Amazon' | 'Newegg';
  /** The exact part name/model, read out to screen readers alongside the CTA. */
  partName: string;
  link: RetailerLink;
  /** 'pill' matches PartCard's chip buttons; 'text' matches BuildSummary's compact row links. */
  variant: 'pill' | 'text';
  accentColor: string;
  pillBackground?: string;
  pillBorder?: string;
}

const PILL_CLASS = 'flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded-md transition-opacity hover:opacity-80';
const TEXT_CLASS = 'flex-shrink-0 text-[9px] font-bold transition-opacity hover:opacity-80';

export default function RetailerLinkCta({
  retailer, partName, link, variant, accentColor, pillBackground, pillBorder,
}: Props) {
  if (link.state === 'unavailable' || !link.href) {
    return (
      <span
        data-link-state="unavailable"
        className={variant === 'pill' ? PILL_CLASS : TEXT_CLASS}
        style={{ color: 'var(--ff-text-3)' }}
      >
        {retailer} unavailable
      </span>
    );
  }

  const isExact = link.state === 'exact';
  const label = isExact ? `View at ${retailer}` : `Search ${retailer}`;
  const ariaLabel = isExact
    ? `View ${partName} at ${retailer} — exact product page${link.sponsored ? ' (affiliate link)' : ''}, opens in a new tab`
    : `Search ${retailer} for ${partName} — opens a retailer search, not the exact product; confirm the model, price, and availability before buying`;

  return (
    <a
      href={link.href}
      target="_blank"
      rel={link.sponsored ? 'noopener noreferrer sponsored' : 'noopener noreferrer'}
      aria-label={ariaLabel}
      title={isExact ? undefined : 'Opens a retailer search — confirm the exact model before buying'}
      data-link-state={link.state}
      className={variant === 'pill' ? PILL_CLASS : TEXT_CLASS}
      style={variant === 'pill'
        ? { color: accentColor, backgroundColor: pillBackground, border: pillBorder }
        : { color: accentColor }}
    >
      {label}
      {variant === 'pill' && (isExact
        ? <ExternalLink size={10} aria-hidden="true" />
        : <Search size={10} aria-hidden="true" />)}
    </a>
  );
}
