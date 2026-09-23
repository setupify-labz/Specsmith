// The admission audit is the LARGEST refusal path in a dry run, and until now
// the least reviewable.
//
// Run 35284766312 refused 1678 motherboard candidates on `kind` alone, and
// roughly six thousand listings across all twelve categories. What the report
// offered for each reason was three titles clipped at 120 characters with no
// identifier — so a reviewer who suspected a rule was over-reaching had three
// anonymous fragments to go on.
//
// That is exactly the shape that made the two product gates' false positives
// untraceable, and it cost a dry run each time to find them. The difference
// here is that recording EVERY refusal would be wrong: six thousand records is
// a report nobody reads. So the cap stays and the samples get useful.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { emptyAudit, noteRejection, SAMPLES_PER_REASON, type CandidateAudit } from './generate-affiliate-catalog';

/** A title longer than the 120 characters the old shape clipped to. */
const LONG_TITLE =
  'ASUS TUF GAMING B850M-PLUS WIFI Motherboard & AMD Ryzen 9 9950X CPU Combo, AMD AM5 B850 mATX, 14+2+1 80A DrMOS stages, DDR5, PCIe 5.0 M.2';

describe('admission samples are bounded, but each one is worth having', () => {
  it('keeps the complete title — no clipping at any length', () => {
    // The assertion that would have failed before. 120 characters is enough
    // to lose the part of a title that says what the listing actually is:
    // here, everything from "DDR5" onwards.
    const audit = emptyAudit();
    expect(LONG_TITLE.length).toBeGreaterThan(120);
    noteRejection(audit, 'kind', LONG_TITLE, '9SIC6E1M4K6972');

    expect(audit.samples).toHaveLength(1);
    expect(audit.samples[0].title).toBe(LONG_TITLE);
    expect(audit.samples[0].title.length).toBe(LONG_TITLE.length);
  });

  it('carries the SKU, so the listing can be looked up', () => {
    const audit = emptyAudit();
    noteRejection(audit, 'kind', LONG_TITLE, '9SIC6E1M4K6972');
    expect(audit.samples[0].sku).toBe('9SIC6E1M4K6972');
  });

  it('records a null SKU rather than pretending, when the feed gave none', () => {
    // Several call sites pass a GPU id or a search keyword rather than a
    // listing, and those have no SKU. Null is the honest value.
    const audit = emptyAudit();
    noteRejection(audit, 'fetch-failed-http', 'gaming motherboard');
    expect(audit.samples[0].sku).toBeNull();
    expect(audit.samples[0].title).toBe('gaming motherboard');
  });

  it('counts every refusal while sampling only a few', () => {
    // The count is the complete figure; the samples are the illustration.
    // Conflating the two is how a reader mistakes three for all of them.
    const audit = emptyAudit();
    for (let index = 0; index < 1678; index += 1) {
      noteRejection(audit, 'kind', `${LONG_TITLE} #${index}`, `9SITEST${index}`);
    }
    expect(audit.rejections.kind).toBe(1678);
    expect(audit.samples).toHaveLength(SAMPLES_PER_REASON);
  });

  it('samples each reason independently', () => {
    const audit = emptyAudit();
    for (const reason of ['kind', 'condition', 'price']) {
      for (let index = 0; index < 5; index += 1) {
        noteRejection(audit, reason, `${reason} listing ${index}`, `9SI${reason}${index}`);
      }
    }
    for (const reason of ['kind', 'condition', 'price']) {
      expect(audit.samples.filter((sample) => sample.reason === reason)).toHaveLength(SAMPLES_PER_REASON);
    }
    expect(audit.samples).toHaveLength(3 * SAMPLES_PER_REASON);
  });

  it('the feed call site actually passes the SKU through', () => {
    // A MUTATION CONTROL FOUND THIS GAP. Dropping the `sku` argument where
    // admission refuses a feed item broke nothing, because every test above
    // calls `noteRejection` directly and never exercises the wiring. The
    // helper was correct in isolation and the production path was not — the
    // same seam that hid the retailPrice/salePrice defect.
    const source = readFileSync(new URL('./generate-affiliate-catalog.ts', import.meta.url), 'utf-8');
    expect(source).toContain("noteRejection(audit, admission.reason, childText(item, 'productname'), childText(item, 'sku'))");
  });

  it('records nothing when there is no title to record', () => {
    // A refusal with no title at all is still COUNTED — losing the count
    // would understate what a gate refused.
    const audit: CandidateAudit = emptyAudit();
    noteRejection(audit, 'required-field', null, '9SINOTITLE');
    expect(audit.rejections['required-field']).toBe(1);
    expect(audit.samples).toHaveLength(0);
  });
});
