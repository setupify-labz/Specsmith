import { useState } from 'react';
import { Cpu } from 'lucide-react';
import type { AffiliatePart } from '../lib/retail/partCatalog';

/** A model-level guide does not specify a board-partner SKU. Never borrow
 * a photograph without saying which retailer variant it actually depicts. */
export function guideGpuExample(parts: AffiliatePart[], canonicalId: string) {
  return parts.find(part => part.category === 'gpu' && part.specsVerified === true
    && part.canonicalPartId === canonicalId);
}

export default function GuideProductImage({ part, model }: { part?: AffiliatePart; model: string }) {
  const [failed, setFailed] = useState(false);
  if (!part || failed) return (
    <div className="flex items-center gap-3 px-6 pt-6 text-secondary-custom">
      <Cpu size={24} aria-hidden="true" className="shrink-0" />
      <div><p className="text-sm font-semibold text-ff-primary">{model}</p>
        <p className="text-xs mt-1">Product photo unavailable</p></div>
    </div>
  );
  return (
    <figure className="min-w-0">
      <div className="retail-photo-frame flex h-44 items-center justify-center overflow-hidden">
        {part && !failed ? (
          <img src={part.imageUrl} alt={part.name} loading="lazy" decoding="async"
            onError={() => setFailed(true)} className="h-full w-full object-contain p-4" />
        ) : (
          <div className="text-center text-[#555566] p-4">
            <Cpu size={40} aria-hidden="true" className="mx-auto mb-2" />
            <p className="text-sm font-semibold">{model}</p>
            <p className="text-xs mt-1">Product photo unavailable</p>
          </div>
        )}
      </div>
      <figcaption className="px-4 pt-3 text-xs leading-relaxed text-secondary-custom">
        {part && !failed ? <>Retailer GPU example: {part.name}. Board-partner variant shown, not an exact shopping list.</>
          : 'Model-level guide. No verified retailer photo to show.'}
      </figcaption>
    </figure>
  );
}
