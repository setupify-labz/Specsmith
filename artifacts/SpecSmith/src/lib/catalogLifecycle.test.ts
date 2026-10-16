import { describe, it, expect } from 'vitest';
import audit from '../data/catalogAudit.json';
import cpus from '../data/cpus.json';
import gpus from '../data/gpus.json';
import components from '../data/components.json';
import peripherals from '../data/peripherals.json';
import benchmarkRecords from '../data/benchmarkRecords.json';
import lifecycleMap from '../data/catalogLifecycle.json';
import { isRecommendable, notRecommendedReason, recommendable } from './catalogLifecycle';

interface AuditEntry { category: string; validity: string; lifecycle: string; lifecycleReason: string; validityNote?: string }
const auditEntries = audit.entries as Record<string, AuditEntry>;
const getCatalogAuditEntry = (id: string): AuditEntry | undefined => auditEntries[id];
import { MATCHUPS } from './matchups';
import { QUIZ_USE_CASES, getQuizTiers, getQuizResult } from './quiz';
import { USE_CASES, getTierPicks } from './useCaseBuilds';
import { GPU_BUDGET_TIERS, CPU_BUDGET_TIERS, getBudgetPicks } from './budgetPages';
import { COMPONENT_GUIDES } from './componentGuides';
import { getSffPicks } from './sffBuilds';

const CATEGORY_SOURCES: Record<string, { id: string; name: string }[]> = {
  cpu: cpus,
  gpu: gpus,
  motherboard: components.motherboards,
  ram: components.ram,
  storage: components.storage,
  psu: components.psus,
  case: components.cases,
  cooler: components.coolers,
  monitor: peripherals.monitors,
  keyboard: peripherals.keyboards,
  mouse: peripherals.mice,
  headset: peripherals.headsets,
};

const VALIDITY = new Set(['valid', 'corrected', 'needs-review', 'invalid']);
const LIFECYCLE = new Set(['current', 'previous-generation', 'legacy']);

describe('catalog audit ledger', () => {
  it('inventories every category with its true part count', () => {
    expect(Object.keys(audit.inventory).sort()).toEqual(Object.keys(CATEGORY_SOURCES).sort());
    for (const [category, parts] of Object.entries(CATEGORY_SOURCES)) {
      expect(audit.inventory[category as keyof typeof audit.inventory].count, category).toBe(parts.length);
    }
  });

  it('records a validity and lifecycle state for every listed part, in the right category', () => {
    for (const [category, parts] of Object.entries(CATEGORY_SOURCES)) {
      for (const part of parts) {
        const entry = getCatalogAuditEntry(part.id);
        expect(entry, `${category}/${part.id} missing from catalogAudit.json`).toBeDefined();
        expect(entry!.category).toBe(category);
        expect(VALIDITY.has(entry!.validity), `${part.id} validity`).toBe(true);
        expect(LIFECYCLE.has(entry!.lifecycle), `${part.id} lifecycle`).toBe(true);
        expect(entry!.lifecycleReason.length).toBeGreaterThan(0);
        if (entry!.validity !== 'valid') expect(entry!.validityNote, `${part.id} needs a note`).toBeTruthy();
      }
    }
  });

  it('ships a runtime exclusion list that matches the annotated ledger exactly', () => {
    const expected: Record<string, string> = {};
    for (const [id, e] of Object.entries(auditEntries)) {
      if (e.validity === 'invalid') expected[id] = 'invalid';
      else if (e.lifecycle === 'legacy') expected[id] = 'legacy';
      else if (e.validity === 'needs-review') expected[id] = 'needs-review';
    }
    expect(lifecycleMap).toEqual(expected);
    for (const id of Object.keys(auditEntries)) expect(notRecommendedReason(id)).toBe(expected[id] ?? null);
  });

  it('has no orphan entries for parts that are no longer listed', () => {
    const listed = new Set(Object.values(CATEGORY_SOURCES).flat().map((p) => p.id));
    for (const id of Object.keys(audit.entries)) expect(listed.has(id), `orphan ${id}`).toBe(true);
  });

  it('has no duplicate ids or duplicate product names across the catalog', () => {
    const all = Object.values(CATEGORY_SOURCES).flat();
    expect(new Set(all.map((p) => p.id)).size).toBe(all.length);
    const names = all.map((p) => p.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('recommendability', () => {
  it('excludes legacy, invalid and needs-review parts', () => {
    expect(isRecommendable('rtx5070')).toBe(true);
    expect(isRecommendable('rtx4070s')).toBe(true); // previous-generation still recommendable
    expect(isRecommendable('rtx3060')).toBe(false); // legacy
    expect(isRecommendable('rtx4050')).toBe(false); // invalid: no desktop RTX 4050 exists
    expect(isRecommendable('cmh212')).toBe(false); // ambiguous variant
    expect(recommendable([{ id: 'rx9070' }, { id: 'rx6600' }]).map((p) => p.id)).toEqual(['rx9070']);
  });

  it('keeps every recommender category non-empty', () => {
    for (const [category, parts] of Object.entries(CATEGORY_SOURCES)) {
      expect(recommendable(parts).length, category).toBeGreaterThan(0);
    }
  });
});

describe('legacy benchmark identities are preserved', () => {
  it('every GPU/CPU id referenced by benchmark records and matchups still exists in the catalog', () => {
    const ids = new Set([...cpus, ...gpus].map((p) => p.id));
    const referenced = new Set<string>();
    for (const record of benchmarkRecords as Record<string, unknown>[]) {
      for (const key of ['gpuId', 'cpuId', 'gpu_id', 'cpu_id']) {
        const value = record[key];
        if (typeof value === 'string') referenced.add(value);
      }
    }
    for (const m of MATCHUPS) { referenced.add(m.gpuA); referenced.add(m.gpuB); }
    for (const id of referenced) expect(ids.has(id), `dangling reference ${id}`).toBe(true);
  });
});

describe('recommenders only recommend recommendable parts', () => {
  const expectRecommendable = (id: string, where: string) =>
    expect(isRecommendable(id), `${where} recommended ${id}`).toBe(true);

  it('quiz results', () => {
    for (const uc of QUIZ_USE_CASES) {
      for (const tier of getQuizTiers(uc.slug)) {
        const result = getQuizResult(uc.slug, tier.index);
        expect(result, `${uc.slug}#${tier.index}`).not.toBeNull();
        expectRecommendable(result!.gpu.id, `quiz ${uc.slug}`);
        expectRecommendable(result!.cpu.id, `quiz ${uc.slug}`);
      }
    }
  });

  it('use-case build picks', () => {
    for (const uc of USE_CASES) {
      for (const pick of getTierPicks(uc)) {
        expectRecommendable(pick.gpu.id, uc.slug);
        expectRecommendable(pick.cpu.id, uc.slug);
      }
    }
  });

  it('budget page picks', () => {
    for (const tier of GPU_BUDGET_TIERS) for (const p of getBudgetPicks('gpu', tier)) expectRecommendable(p.part.id, tier.slug);
    for (const tier of CPU_BUDGET_TIERS) for (const p of getBudgetPicks('cpu', tier)) expectRecommendable(p.part.id, tier.slug);
  });

  it('component guide picks', () => {
    for (const guide of COMPONENT_GUIDES) for (const p of guide.picks) expectRecommendable(p.item.id, guide.slug);
  });

  it('small-form-factor build picks', () => {
    for (const pick of getSffPicks()) {
      for (const part of [pick.gpu, pick.cpu, pick.motherboard, pick.cooler, pick.case]) expectRecommendable(part.id, 'sff');
    }
  });
});
