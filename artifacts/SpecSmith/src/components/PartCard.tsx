import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { getAmazonLink, getNeweggLink } from '../lib/retailerLinkState';
import RetailerLinkCta from './RetailerLinkCta';

interface PartCardProps {
  id: string;
  name: string;
  image?: string;
  searchQuery?: string;
  price_usd?: number;
  affiliateUrl?: string;
  selected: boolean;
  sponsored?: boolean;
  recommended?: boolean;
  badge?: 'best-value' | 'best-performance';
  specs: { label: string; value: string }[];
  tier?: number;
  onSelect: (id: string) => void;
}

const tierGradients: Record<number, string> = {
  10: 'linear-gradient(135deg, #FFD700, #FFA500)',
  9:  'linear-gradient(135deg, #00D4FF, #00B4DD)',
  8:  'linear-gradient(135deg, #6C63FF, #9C63FF)',
  7:  'linear-gradient(135deg, #6C63FF, #8C83FF)',
  6:  'linear-gradient(135deg, #00E676, #00C866)',
  5:  'linear-gradient(135deg, #00E676, #00C866)',
  4:  'linear-gradient(135deg, #FFB300, #FF9800)',
  3:  'linear-gradient(135deg, #FF8C00, #FF6000)',
  2:  'linear-gradient(135deg, #FF1744, #CC0000)',
  1:  'linear-gradient(135deg, #FF1744, #CC0000)',
};

const tierLabels: Record<number, string> = {
  10: 'Flagship', 9: 'High-End', 8: 'Enthusiast',
  7: 'Performance', 6: 'Upper Mid', 5: 'Mid-Range',
  4: 'Entry', 3: 'Budget', 2: 'Basic', 1: 'Legacy',
};

const badgeStyles: Record<'best-value' | 'best-performance', { label: string; background: string; color: string; border: string }> = {
  'best-value': {
    label: 'BEST VALUE',
    background: '#00E67618',
    color: 'var(--ff-green)',
    border: '1px solid #00E67650',
  },
  'best-performance': {
    label: 'BEST PERFORMANCE',
    background: 'linear-gradient(135deg, #FF6EC7, #FF3D9A)',
    color: 'white',
    border: 'none',
  },
};

export default function PartCard({
  id, name, image, searchQuery, price_usd, affiliateUrl, selected, sponsored, recommended, badge, specs, tier, onSelect
}: PartCardProps) {
  const query = searchQuery ?? name;
  const amazonLink = getAmazonLink(query);
  const neweggLink = getNeweggLink(query, affiliateUrl);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={`relative rounded-2xl p-4 cursor-pointer card-hover transition-all ${
        recommended ? 'recommended-card' :
        selected ? 'selected-card' : 'border'
      }`}
      style={{
        backgroundColor: 'var(--ff-card)',
        borderColor: selected ? 'var(--ff-accent)' : 'var(--ff-border)',
        border: selected || recommended ? undefined : '1px solid var(--ff-border)',
      }}
    >
      {/* Selecting a part is this card's primary action. A real <button>
          filling the card (rather than role="button" on the outer div)
          keeps it a sibling of the Amazon/Newegg links below instead of
          their ancestor — axe-core's nested-interactive check flags the
          latter, since a button containing other focusable controls isn't
          reliably operable across all screen readers even though it works
          in a quick manual test. The content layer above it has
          pointer-events: none so clicks pass through to this button
          everywhere except the two links, which opt back in. */}
      <button
        type="button"
        className="absolute inset-0 w-full h-full rounded-2xl"
        style={{ zIndex: 0 }}
        onClick={() => onSelect(id)}
        aria-pressed={selected}
        aria-label={`${name}${price_usd === undefined ? '' : `, estimated ${price_usd.toLocaleString()}`}${selected ? ', selected' : ''}`}
      />

      <div className="relative" style={{ zIndex: 1, pointerEvents: 'none' }}>
        {/* Corner badges */}
        {selected && !sponsored && (
          <div className="absolute top-3 right-3 w-5 h-5 rounded-full bg-[#00E676] flex items-center justify-center z-10">
            <Check size={11} className="text-black" strokeWidth={3} />
          </div>
        )}
        {sponsored && !selected && (
          <span className="absolute top-3 right-3 text-[10px] font-bold px-2 py-0.5 rounded-full z-10"
            style={{ backgroundColor: '#FFB30018', color: 'var(--ff-amber)', border: '1px solid #FFB30040' }}>
            SPONSORED
          </span>
        )}
        {recommended && (
          <span className="absolute top-3 right-3 text-[10px] font-bold px-2 py-0.5 rounded-full z-10"
            style={{ background: 'linear-gradient(135deg, var(--ff-accent), var(--ff-cyan))', color: 'white' }}>
            RECOMMENDED
          </span>
        )}

        {/* Performance/value accolade stays in normal flow so it can never
            overlap the part name or tier chip at narrower card widths. */}
        {badge && (
          <div className="mb-2 flex">
            <span className="text-[9px] font-bold px-2 py-0.5 rounded-full tracking-wide"
              style={{
                background: badgeStyles[badge].background,
                color: badgeStyles[badge].color,
                border: badgeStyles[badge].border,
              }}>
              {badgeStyles[badge].label}
            </span>
          </div>
        )}

        {/* Header */}
        <div className="flex items-start justify-between gap-2 mb-3">
          {image && (
            <div
              className="flex-shrink-0 w-14 h-14 rounded-lg overflow-hidden flex items-center justify-center"
              style={{ backgroundColor: 'var(--ff-bg)' }}
            >
              <img src={image} alt="" loading="lazy" referrerPolicy="no-referrer" className="w-full h-full object-contain p-1" />
            </div>
          )}
          <div className="flex-1 min-w-0 pr-14">
            {/* Not a document heading — dozens of these render per open
                category, and using <h4> here skipped past <h2>/<h3> in the
                page outline and failed the heading-order check (same fix
                already applied to the card label in HeroFpsCard.tsx). */}
            <p className="font-semibold text-sm leading-tight" style={{ color: 'var(--ff-text)' }}>{name}</p>
            {tier !== undefined && (
              <span
                className="inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full text-white"
                style={{ background: tierGradients[tier] ?? '#8888AA' }}
              >
                {tierLabels[tier] ?? `Tier ${tier}`}
              </span>
            )}
          </div>
        </div>

        {/* Specs */}
        <div className="space-y-1 mb-3">
          {specs.map(s => (
            <div key={s.label} className="flex items-center justify-between text-xs">
              <span style={{ color: 'var(--ff-text-2)' }}>{s.label}</span>
              <span className="font-medium" style={{ color: 'var(--ff-text)' }}>{s.value}</span>
            </div>
          ))}
        </div>

        {/* Price + retailer links */}
        <div className="flex items-center justify-between pt-3" style={{ borderTop: '1px solid var(--ff-border)' }}>
          <span
            className="text-lg font-bold"
            style={{ color: 'var(--ff-text)' }}
            title={price_usd === undefined ? undefined : 'Estimated catalog price — verify the current price at the retailer'}
          >
            {price_usd === undefined ? 'Price at retailer' : `Est. ${price_usd.toLocaleString()}`}
          </span>
          <div className="flex flex-wrap items-center justify-end gap-1.5" style={{ pointerEvents: 'auto' }}>
            <RetailerLinkCta
              retailer="Amazon"
              partName={name}
              link={amazonLink}
              variant="pill"
              accentColor="var(--ff-accent-text)"
              pillBackground="rgba(108,99,255,0.12)"
              pillBorder="1px solid rgba(108,99,255,0.3)"
            />
            <RetailerLinkCta
              retailer="Newegg"
              partName={name}
              link={neweggLink}
              variant="pill"
              accentColor="var(--ff-newegg)"
              pillBackground="rgba(255,158,27,0.10)"
              pillBorder="1px solid rgba(255,158,27,0.3)"
            />
          </div>
        </div>
      </div>
    </motion.div>
  );
}
