import { describe, expect, it } from 'vitest';

import catalogData from '../../../public/data/retail-parts.json';
import { parseAffiliatePartCatalog } from './partCatalog';
import {
  COLOR_NEUTRAL_CATEGORIES,
  isColorNeutralCategory,
  whiteBuildParts,
  WHITE_EMPTY_MESSAGE,
  classifyWhiteFinish,
  whiteCountsByCategory,
  whiteParts,
} from './whiteBuild';

const parsed = parseAffiliatePartCatalog(catalogData);
if (!parsed.ok) throw new Error(`published catalogue invalid: ${parsed.problem}`);
const catalog = parsed.catalog;

describe('a white finish is admitted only when the merchant title says so', () => {
  it('accepts the ways a retailer actually writes it', () => {
    const accepted = [
      'ZOTAC SOLID OC White Edition GeForce RTX 5080 Graphics Card',
      'ASUS PRIME GeForce RTX 5070 Graphics Card PRIME-RTX5070-O12G-WHITE',
      'Orzly Gaming Headset (White) for PC and Gaming Consoles',
      'Thermalright Phantom Spirit 120 Vision SNOW CPU Cooler',
      'LIAN LI SUP01 White Steel / Tempered Glass ATX Mid Tower Computer Case',
      'Audio Technica High Fidelity Closed Back Gaming Headset - White',
    ];
    for (const title of accepted) {
      expect(classifyWhiteFinish(title).white, title).toBe(true);
    }
  });

  it('says which words it found, so a card can show its evidence', () => {
    const verdict = classifyWhiteFinish('COUGAR Archon 2 Mesh RGB White Computer Case');
    expect(verdict.white).toBe(true);
    if (!verdict.white) return;
    expect(verdict.evidence).toContain('white');
  });
});

describe('the refusals — the half that keeps this honest', () => {
  it('refuses a white BACKLIGHT on a black keyboard', () => {
    // Live in the catalogue: the Keychron K8 is not a white keyboard.
    const verdict = classifyWhiteFinish(
      'Keychron K8 Tenkeyless Wireless Mechanical Keyboard for Mac, White Backlight, Bluetooth',
    );
    expect(verdict).toEqual({ white: false, refusal: 'describes-something-else' });
  });

  it('refuses white KEYCAPS, which say nothing about the board', () => {
    const verdict = classifyWhiteFinish(
      'Womier Wireless 60% Gaming Keyboard, Tri-Mode Thocky Custom Black White Keycaps',
    );
    expect(verdict).toEqual({ white: false, refusal: 'describes-something-else' });
  });

  it('refuses a white SWITCH colour', () => {
    const verdict = classifyWhiteFinish(
      'Keychron K3 75% Wireless Mechanical Keyboard with Low-Profile Optical Red Switch/White',
    );
    expect(verdict).toEqual({ white: false, refusal: 'describes-something-else' });
  });

  it('refuses every other thing that merely happens to be white', () => {
    for (const title of [
      'Gaming Mouse with White LED lighting',
      'Monitor with white text on a black background',
      'Camera with automatic white balance',
      'Case fan with white light ring',
      'Printer with white paper tray',
    ]) {
      expect(classifyWhiteFinish(title), title).toEqual({
        white: false,
        refusal: 'describes-something-else',
      });
    }
  });

  it('does not read a colour out of a model number', () => {
    // "SUP01W" and "GT650WH" contain a W. That is not evidence, and treating
    // it as evidence would admit half the catalogue.
    expect(classifyWhiteFinish('LIAN LI SUP01W Mid Tower Computer Case').white).toBe(false);
    expect(classifyWhiteFinish('SAMA GT650WH 80 PLUS Gold Power Supply').white).toBe(false);
  });

  it('separates "no colour word at all" from "the word meant something else"', () => {
    // Two different facts. A category with neither still shows the same empty
    // state, but the refusal is the thing a test can hold on to.
    expect(classifyWhiteFinish('MSI Ventus GeForce RTX 3050')).toEqual({
      white: false,
      refusal: 'no-colour-word',
    });
    expect(classifyWhiteFinish('Keyboard with White Backlight')).toEqual({
      white: false,
      refusal: 'describes-something-else',
    });
  });

  it('is not fooled by a word that merely contains "white" or "snow"', () => {
    for (const title of ['Snowblind side panel kit', 'Whitening cloth for screens']) {
      expect(classifyWhiteFinish(title).white, title).toBe(false);
    }
  });
});

describe('colour is never inferred from anything but the title', () => {
  it('ignores the image, the brand and the canonical model', () => {
    // Same brand, same canonical model, same image host — one states a white
    // finish and one does not, and only the title separates them.
    const asusWhite = 'ASUS PRIME GeForce RTX 5070 Graphics Card PRIME-RTX5070-O12G-WHITE';
    const asusPlain = 'ASUS PRIME GeForce RTX 5070 Graphics Card PRIME-RTX5070-O12G';
    expect(classifyWhiteFinish(asusWhite).white).toBe(true);
    expect(classifyWhiteFinish(asusPlain).white).toBe(false);
  });
});

describe('against the real published catalogue', () => {
  it('finds white products without admitting the known false positives', () => {
    const white = whiteParts(catalog.parts);
    expect(white.length).toBeGreaterThan(0);
    expect(white.length).toBeLessThan(catalog.parts.length / 10);
    // The three keyboards that mention white are all describing something
    // else, so the keyboard collection is empty rather than wrong.
    const keyboardsMentioningWhite = catalog.parts.filter(
      (part) => part.category === 'keyboard' && /white/i.test(part.name),
    );
    expect(keyboardsMentioningWhite.length).toBeGreaterThan(0);
    expect(white.some((part) => part.category === 'keyboard')).toBe(false);
  });

  it('keeps each SKU exactly as it is — price, image and link', () => {
    // A collection is a filter, never a rewrite. Nothing about a listing
    // changes by being shown here.
    for (const part of whiteParts(catalog.parts)) {
      const original = catalog.parts.find((candidate) => candidate.id === part.id);
      expect(original).toBeDefined();
      expect(part).toEqual(original);
    }
  });

  it('never lets one variant lend its price to another', () => {
    // The white and non-white SKUs of one model are different products with
    // different prices, and the collection holds only the listings it matched.
    const white = whiteParts(catalog.parts);
    for (const part of white) {
      expect(classifyWhiteFinish(part.name).white, part.name).toBe(true);
    }
  });

  it('counts each category, and leaves the ones with nothing at zero', () => {
    const counts = whiteCountsByCategory(catalog.parts);
    const total = Object.values(counts).reduce((sum, count) => sum + (count ?? 0), 0);
    expect(total).toBe(whiteParts(catalog.parts).length);
    for (const [category, count] of Object.entries(counts)) {
      expect(count, category).toBeGreaterThan(0);
    }
    // At least one category genuinely has none — that is the empty state the
    // interface has to be honest about rather than pad.
    expect(Object.keys(counts).length).toBeLessThan(12);
  });

  it('has an empty state that explains itself instead of apologising', () => {
    expect(WHITE_EMPTY_MESSAGE).toContain('white finish');
    expect(WHITE_EMPTY_MESSAGE.toLowerCase()).not.toContain('in stock');
    expect(WHITE_EMPTY_MESSAGE.toLowerCase()).not.toContain('out of stock');
  });
});

describe('the White build can still complete a PC', () => {
  // The defect this covers: filtering EVERY category by finish emptied the
  // ones whose merchant titles never state a colour, so the collection could
  // not produce a working machine. Zero CPUs does not make a build whiter.

  const parts = catalog.parts;
  const inView = whiteBuildParts(parts);
  const countIn = (list: readonly { category: string }[], category: string) =>
    list.filter((part) => part.category === category).length;

  it('keeps every colour-neutral category at its full, unfiltered count', () => {
    for (const category of COLOR_NEUTRAL_CATEGORIES) {
      const all = countIn(parts, category);
      expect(all, `${category} should exist in the catalogue`).toBeGreaterThan(0);
      expect(countIn(inView, category), category).toBe(all);
    }
  });

  it('leaves CPU and storage selectable, which is what makes the build finishable', () => {
    // Named explicitly, because these two are the ones the review called out.
    expect(countIn(inView, 'cpu')).toBeGreaterThan(0);
    expect(countIn(inView, 'storage')).toBeGreaterThan(0);
  });

  it('still narrows every appearance-relevant category to stated-white listings', () => {
    // The filter is not weakened where it means something: each remaining part
    // in a visible category has to carry the claim in its own title.
    for (const part of inView) {
      if (isColorNeutralCategory(part.category)) continue;
      expect(classifyWhiteFinish(part.name).white, part.name).toBe(true);
    }
  });

  it('does not smuggle a colour claim into the neutral categories', () => {
    // They are shown as ordinary parts. Nothing asserts they are white, and
    // the catalogue in fact states white for none of them.
    for (const category of COLOR_NEUTRAL_CATEGORIES) {
      const stated = parts.filter((part) => part.category === category && classifyWhiteFinish(part.name).white);
      expect(stated, `${category} titles state no colour`).toHaveLength(0);
    }
  });

  it('still shows an honest absence where a visible category has no white product', () => {
    // Motherboards, RAM, keyboards and mice have zero stated-white listings in
    // the current catalogue. Those must stay empty — that is a real absence,
    // and the fix for CPUs must not paper over it.
    const empty = ['motherboard', 'ram', 'keyboard', 'mouse'];
    for (const category of empty) {
      expect(countIn(parts, category), `${category} should exist`).toBeGreaterThan(0);
      expect(countIn(inView, category), category).toBe(0);
    }
  });

  it('keeps the white filter itself unchanged for counting purposes', () => {
    // whiteParts is what the collection note counts. It must still mean
    // "titles stating white", not "parts the build view shows".
    expect(whiteParts(parts).every((part) => classifyWhiteFinish(part.name).white)).toBe(true);
    expect(whiteParts(parts).length).toBeLessThan(inView.length);
  });

  it('names only categories a finished build hides', () => {
    expect([...COLOR_NEUTRAL_CATEGORIES].sort()).toEqual(['cpu', 'storage']);
  });
});
