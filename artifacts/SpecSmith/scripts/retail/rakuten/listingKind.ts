// What KIND of thing is this listing, and is it new?
//
// The Video Cards & Adapters category is necessary but not sufficient: by
// Newegg's own naming it also holds the adapters, and a DisplayPort cable
// named after the card it plugs into sits in the same aisle as the card. These
// gates run before the model gates so that a $19 accessory whose title happens
// to contain "RTX 5090" is refused as an accessory, which is what it is,
// rather than accepted as a spectacularly cheap graphics card.
//
// Each pattern is written to be SPECIFIC rather than broad, because a false
// rejection costs one offer while a false acceptance publishes a wrong price.
// Where a word is ambiguous the pattern requires the phrase that disambiguates
// it: "Desktop Graphics Card" is a card and must pass; "Gaming Desktop" is a
// computer and must not.

/**
 * Accessories that live in the same category as the cards.
 *
 * "adapter" is deliberately absent as a bare word — it is half the category's
 * own name and appears in card titles ("HDMI adapter included"). The specific
 * accessory nouns below carry the meaning instead.
 */
const ACCESSORY_RE =
  /\b(cable|cord|riser|extender|extension|bracket|backplate|back plate|anti-?sag|sag bracket|gpu support|support (?:bracket|stick|arm)|holder|stand|mount|water ?block|cooler kit|thermal (?:pad|paste)|shroud|screw kit|splitter|dongle|dust cover|display ?port adapter|hdmi adapter|dvi adapter|vga adapter|usb adapter|pcie? adapter|m\.2 adapter|docking station|egpu enclosure|enclosure|ai box)\b/i;

/** Laptops, and laptop GPUs, which share a name with their desktop siblings but not their power limit. */
const LAPTOP_RE = /\b(laptop|notebook|max-?q)\b|\(\s*mobile\b|\bmobile (?:gpu|graphics)\b/i;

/**
 * A whole computer that CONTAINS the card.
 *
 * "desktop" alone is not enough: add-in-board titles legitimately say "Desktop
 * Graphics Card" to distinguish themselves from the mobile part. The word only
 * indicates a system when paired with a system noun, so that pairing is what
 * is matched.
 */
const PREBUILT_RE =
  /\b(gaming desktop|desktop (?:pc|computer|system|tower)|(?:gaming|desktop) computer|gaming pc|prebuilt|pre-?built|barebone|workstation (?:pc|desktop|system)|all-?in-?one pc|mini pc)\b/i;

/** Anything not sold as new. The catalog prices new parts, so these are a different market. */
const USED_RE =
  /\b(refurbished|refurb|renewed|recertified|re-?certified|open ?box|used|pre-?owned|second ?hand|as-?is|for parts|grade [abc]\b|scratch ?(?:and|&) ?dent)\b/i;

export type ListingKindIssue = 'not-a-graphics-card' | 'laptop-part' | 'prebuilt-system' | 'condition-not-new';

export interface KindVerdict {
  issue: ListingKindIssue | null;
  detail: string;
}

/**
 * Classifies a listing by product kind and condition.
 *
 * Evaluated in a fixed order — accessory, laptop, prebuilt, condition — so a
 * refurbished laptop reports 'laptop-part'. The kind of thing it is, is the
 * more fundamental disqualification, and reporting one reason per listing
 * keeps the rejection counts readable.
 */
export function classifyListing(productName: string, description = ''): KindVerdict {
  // Only the TITLE is matched. A card's long description routinely mentions
  // laptops and prebuilts in comparison ("faster than a gaming laptop"), and
  // matching prose would reject genuine cards. The title is the merchant's
  // claim about what the item is.
  const name = String(productName ?? '');
  void description;

  const accessory = ACCESSORY_RE.exec(name);
  if (accessory) return { issue: 'not-a-graphics-card', detail: `Title names an accessory ("${accessory[0]}"), not a graphics card.` };

  const laptop = LAPTOP_RE.exec(name);
  if (laptop) return { issue: 'laptop-part', detail: `Title indicates a laptop part ("${laptop[0]}"). SpecSmith's catalog holds desktop add-in boards.` };

  const prebuilt = PREBUILT_RE.exec(name);
  if (prebuilt) return { issue: 'prebuilt-system', detail: `Title indicates a complete system ("${prebuilt[0]}"), which contains a card rather than being one.` };

  const used = USED_RE.exec(name);
  if (used) return { issue: 'condition-not-new', detail: `Title indicates a non-new condition ("${used[0]}").` };

  return { issue: null, detail: '' };
}
