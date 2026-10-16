// Review PRIORITY for a staged listing: current-generation hardware first,
// then valuable recent generations, then everything else.
//
// This ORDERS the review queue; it never removes a candidate. Age alone is not
// a reason to drop hardware (issue #190), and an older card a reviewer has not
// seen is still worth seeing — just later. Every tier names the rule that put
// it there, so the ordering is auditable rather than a black box.
//
// Rules read the listing title only, and only for families whose generation
// is unambiguous from the model number. Anything else is "unclassified".

import type { DiscoveryCategory } from './discoveryConfig';

export type GenerationTier = 'current' | 'recent' | 'older' | 'unclassified';

export interface GenerationVerdict {
  tier: GenerationTier;
  /** Which rule matched, e.g. "gpu: RTX 50". */
  rule: string;
}

interface Rule {
  tier: Exclude<GenerationTier, 'unclassified'>;
  label: string;
  pattern: RegExp;
}

const RULES: Partial<Record<DiscoveryCategory, Rule[]>> = {
  gpu: [
    { tier: 'current', label: 'RTX 50', pattern: /\bRTX\s+50\d0\b/i },
    { tier: 'current', label: 'Radeon RX 9000', pattern: /\bRX\s+90\d0\b/i },
    { tier: 'current', label: 'Arc B-series', pattern: /\bArc\s+B\d{3}\b/i },
    { tier: 'recent', label: 'RTX 40', pattern: /\bRTX\s+40\d0\b/i },
    { tier: 'recent', label: 'Radeon RX 7000', pattern: /\bRX\s+7\d00\b/i },
    { tier: 'older', label: 'RTX 30 / GTX', pattern: /\b(RTX\s+30\d0|GTX\s+\d{3,4})\b/i },
    { tier: 'older', label: 'Radeon RX 6000 or earlier', pattern: /\bRX\s+[56]\d00\b/i },
    { tier: 'older', label: 'Arc A-series', pattern: /\bArc\s+A\d{3}\b/i },
  ],
  cpu: [
    { tier: 'current', label: 'Core Ultra 200S', pattern: /\bCore\s+Ultra\s+[579]\s+2\d{2}K?F?\b/i },
    { tier: 'current', label: 'Ryzen 9000', pattern: /\bRyzen\s+[3579]\s+9\d{3}/i },
    { tier: 'recent', label: 'Intel 14th gen', pattern: /\bi[3579]-14\d{3}/i },
    { tier: 'recent', label: 'Ryzen 7000', pattern: /\bRyzen\s+[3579]\s+7\d{3}/i },
    { tier: 'older', label: 'Intel 12th/13th gen', pattern: /\bi[3579]-1[23]\d{3}/i },
    { tier: 'older', label: 'Ryzen 5000 or earlier', pattern: /\bRyzen\s+[3579]\s+[1-5]\d{3}/i },
  ],
  motherboard: [
    { tier: 'current', label: 'Intel 800-series / AMD 800-series and AM5 600-series', pattern: /\b(Z890|B860|H810|X870E?|B850|X670E?|B650E?|A620)\b/i },
    { tier: 'recent', label: 'Intel 700-series', pattern: /\b(Z790|B760|H770)\b/i },
    { tier: 'older', label: 'Intel 600-series / AM4', pattern: /\b(Z690|B660|H610|H670|X570|B550|A520|B450)\b/i },
  ],
  ram: [
    { tier: 'current', label: 'DDR5', pattern: /\bDDR5\b/i },
    { tier: 'older', label: 'DDR4', pattern: /\bDDR4\b/i },
  ],
  storage: [
    { tier: 'current', label: 'PCIe 5.0 NVMe', pattern: /\b(PCIe|PCI-E|PCI Express)\s*(5\.0|Gen\s*5)\b|\bGen\s*5\b/i },
    { tier: 'recent', label: 'PCIe 4.0 NVMe', pattern: /\b(PCIe|PCI-E|PCI Express)\s*(4\.0|Gen\s*4)\b|\bGen\s*4\b/i },
  ],
};

export function classifyGeneration(category: DiscoveryCategory, title: string): GenerationVerdict {
  for (const rule of RULES[category] ?? []) {
    if (rule.pattern.test(title)) return { tier: rule.tier, rule: `${category}: ${rule.label}` };
  }
  return { tier: 'unclassified', rule: `${category}: no generation rule matched` };
}

export const GENERATION_ORDER: readonly GenerationTier[] = ['current', 'recent', 'unclassified', 'older'];
