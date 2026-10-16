import { describe, it, expect } from 'vitest';
import audit from '../data/catalogAudit.json';
import lifecycleMap from '../data/catalogLifecycle.json';
import cpus from '../data/cpus.json';
import gpus from '../data/gpus.json';
import components from '../data/components.json';
import peripherals from '../data/peripherals.json';
import benchmarkRecords from '../data/benchmarkRecords.json';
import { catalogLabel, catalogLabelText, isRecommendable, recommendable } from './catalogLifecycle';
import { MATCHUPS } from './matchups';
import { QUIZ_USE_CASES, getQuizTiers, getQuizResult } from './quiz';
import { USE_CASES, getTierPicks, getUseCase } from './useCaseBuilds';
import { GPU_BUDGET_TIERS, CPU_BUDGET_TIERS, getBudgetPicks } from './budgetPages';
import { COMPONENT_GUIDES } from './componentGuides';
import { getSffPicks } from './sffBuilds';
import { prebuilts } from './prebuilts';
import { getMotherboardPicks } from './motherboardPages';
import { getGpuTiers } from './gpuTierList';
import { getCpuTiers } from './cpuTierList';
import { CPU_MATCHUPS } from './matchups';
import { createCatalogLifecycle, eligibleRecommendations } from './catalogLifecycleCore';
import { GAME_PAGES, getGamePicks, getPageGame } from './gamePages';
import { CPU_GAME_PAGES, getCpuGamePicks } from './cpuGamePages';
import fs from 'node:fs';
import path from 'node:path';

interface AuditEntry {
  category: string;
  validity: string;
  lifecycle: string;
  lifecycleReason: string;
  validityNote?: string;
  sources?: string[];
  recommendation: string;
  ineligibleReason?: string;
  ineligibleNote?: string;
}
const auditEntries = audit.entries as Record<string, AuditEntry>;

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
const MANUFACTURER_SOURCE = /^https:\/\/([a-z0-9-]+\.)*(amd|intel|nvidia|gigabyte|lian-li|hyte|lg|razer|keychron|asus|logitech)\.com\//;

describe('catalog audit ledger', () => {
  it('inventories every category with its true part count', () => {
    expect(Object.keys(audit.inventory).sort()).toEqual(Object.keys(CATEGORY_SOURCES).sort());
    for (const [category, parts] of Object.entries(CATEGORY_SOURCES)) {
      expect(audit.inventory[category as keyof typeof audit.inventory].count, category).toBe(parts.length);
    }
  });

  it('records validity, lifecycle and recommendation eligibility for every listed part', () => {
    for (const [category, parts] of Object.entries(CATEGORY_SOURCES)) {
      for (const part of parts) {
        const entry = auditEntries[part.id];
        expect(entry, `${category}/${part.id} missing from catalogAudit.json`).toBeDefined();
        expect(entry.category).toBe(category);
        expect(VALIDITY.has(entry.validity), `${part.id} validity`).toBe(true);
        expect(LIFECYCLE.has(entry.lifecycle), `${part.id} lifecycle`).toBe(true);
        expect(entry.lifecycleReason.length).toBeGreaterThan(0);
        expect(['eligible', 'ineligible']).toContain(entry.recommendation);
        if (entry.validity !== 'valid') expect(entry.validityNote, `${part.id} needs a note`).toBeTruthy();
      }
    }
  });

  it('cites a manufacturer source for every spec correction, invalid verdict and CPU', () => {
    for (const [id, entry] of Object.entries(auditEntries)) {
      const needsSource = entry.validity === 'invalid' || entry.category === 'cpu'
        || (entry.validity === 'corrected' && !/normalisation/.test(entry.validityNote ?? ''));
      if (!needsSource) continue;
      expect(entry.sources?.length, `${id} has no source`).toBeGreaterThan(0);
      for (const url of entry.sources!) expect(url, id).toMatch(MANUFACTURER_SOURCE);
    }
  });

  it('never makes a part ineligible for its age alone', () => {
    for (const [id, entry] of Object.entries(auditEntries)) {
      const concrete = entry.validity === 'invalid' || entry.validity === 'needs-review' || entry.ineligibleReason === 'unsuitable';
      expect(entry.recommendation === 'ineligible', id).toBe(concrete);
      if (entry.recommendation === 'ineligible') expect(entry.ineligibleNote, `${id} needs a reason`).toBeTruthy();
    }
    // Good-value older hardware stays recommendable, labelled as older.
    expect(isRecommendable('rtx3060')).toBe(true);
    expect(isRecommendable('rx6600')).toBe(true);
    expect(catalogLabel('rtx3060')).toBe('legacy');
  });

  it('ships a runtime eligibility list that matches the annotated ledger exactly', () => {
    const eligible = Object.entries(auditEntries).filter(([, e]) => e.recommendation === 'eligible').map(([id]) => id).sort();
    expect(lifecycleMap.eligible).toEqual(eligible);
    for (const [id, entry] of Object.entries(auditEntries)) {
      const expected = entry.recommendation === 'ineligible' ? entry.ineligibleReason : entry.lifecycle === 'legacy' ? 'legacy' : null;
      expect(catalogLabel(id), id).toBe(expected ?? null);
    }
  });

  it('has no orphan entries for parts that are no longer listed', () => {
    const listed = new Set(Object.values(CATEGORY_SOURCES).flat().map((p) => p.id));
    for (const id of Object.keys(auditEntries)) expect(listed.has(id), `orphan ${id}`).toBe(true);
  });

  it('has no duplicate ids or duplicate product names across the catalog', () => {
    const all = Object.values(CATEGORY_SOURCES).flat();
    expect(new Set(all.map((p) => p.id)).size).toBe(all.length);
    const names = all.map((p) => p.name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('recommendation eligibility fails closed', () => {
  it('rejects unknown, unaudited and ineligible ids', () => {
    expect(isRecommendable('rtx5070')).toBe(true);
    expect(isRecommendable('rtx4050')).toBe(false); // invalid: no desktop RTX 4050 exists
    expect(isRecommendable('cmh212')).toBe(false); // ambiguous variant
    expect(isRecommendable('kf8ddr4')).toBe(false); // unsuitable: 8GB
    expect(isRecommendable('not-a-part')).toBe(false); // never audited
    expect(isRecommendable('newegg-gpu-n82e16814126837')).toBe(false); // retail listing id, not a canonical part
    expect(recommendable([{ id: 'rx9070' }, { id: 'brand-new-unaudited-gpu' }]).map((p) => p.id)).toEqual(['rx9070']);
  });

  it('labels parts for the UI', () => {
    expect(catalogLabelText('rtx4050')).toBe('Not a retail desktop part');
    expect(catalogLabelText('rtx3060')).toBe('Older generation');
    expect(catalogLabelText('rtx5070')).toBeNull();
    expect(catalogLabelText('not-a-part')).toBeNull();
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
      for (const key of ['gpuId', 'cpuId']) {
        const value = record[key];
        if (typeof value === 'string') referenced.add(value);
      }
    }
    for (const m of MATCHUPS) { referenced.add(m.gpuA); referenced.add(m.gpuB); }
    for (const id of referenced) expect(ids.has(id), `dangling reference ${id}`).toBe(true);
  });
});

describe('recommenders only recommend eligible parts', () => {
  const expectRecommendable = (id: string, where: string) =>
    expect(isRecommendable(id), `${where} recommended ${id}`).toBe(true);

  it('quiz results', () => {
    for (const uc of QUIZ_USE_CASES) {
      for (const tier of getQuizTiers(uc.slug)) {
        const result = getQuizResult(uc.slug, tier.index);
        expect(result, `${uc.slug}#${tier.index}`).not.toBeNull();
        if (result!.gpu) expectRecommendable(result!.gpu.id, `quiz ${uc.slug}`);
        expectRecommendable(result!.cpu.id, `quiz ${uc.slug}`);
      }
    }
  });

  it('use-case build picks', () => {
    for (const uc of USE_CASES) {
      for (const pick of getTierPicks(uc)) {
        if (pick.gpu) expectRecommendable(pick.gpu.id, uc.slug);
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

  it('curated prebuilt builds', () => {
    for (const build of prebuilts) {
      for (const [slot, id] of Object.entries(build.parts)) if (id) expectRecommendable(id as string, `prebuilt ${build.id}.${slot}`);
    }
  });

  it('motherboard guide picks for every socket', () => {
    for (const socket of new Set(components.motherboards.map((m) => m.socket))) {
      for (const pick of getMotherboardPicks(socket)) expectRecommendable(pick.motherboard.id, `motherboards ${socket}`);
    }
  });

  it('tier-list best-value badges', () => {
    for (const tier of getGpuTiers()) for (const g of tier.gpus) if (g.isBestValueInTier) expectRecommendable(g.gpu.id, `gpu tier ${tier.id}`);
    for (const tier of getCpuTiers()) for (const c of tier.cpus) if (c.isBestValueInTier) expectRecommendable(c.cpu.id, `cpu tier ${tier.id}`);
  });

  it('matchup "Build with" calls to action (either side can win)', () => {
    for (const m of MATCHUPS) for (const id of [m.gpuA, m.gpuB]) expectRecommendable(id, `vs ${m.slug}`);
    for (const m of CPU_MATCHUPS) for (const id of [m.cpuA, m.cpuB]) expectRecommendable(id, `vs ${m.slug}`);
  });

  it('builder imported plans: only eligible parts, and none before the list loads', () => {
    const plan = [{ canonicalId: 'rtx5070' }, { canonicalId: 'cmh212' }, { canonicalId: 'unknown-part' }];
    expect(eligibleRecommendations(plan, null)).toEqual([]);
    const lifecycle = createCatalogLifecycle(lifecycleMap);
    expect(eligibleRecommendations(plan, lifecycle).map((r) => r.canonicalId)).toEqual(['rtx5070']);
  });

  it('per-game GPU and CPU buying picks', () => {
    for (const page of GAME_PAGES) {
      const game = getPageGame(page.gameId)!;
      const picks = getGamePicks(game);
      expect(picks.length, page.gameId).toBeGreaterThan(0);
      for (const p of picks) expectRecommendable(p.gpu.id, `best gpu for ${page.gameId} (${p.label})`);
    }
    for (const page of CPU_GAME_PAGES) {
      const game = getPageGame(page.gameId)!;
      for (const p of getCpuGamePicks(game)) expectRecommendable(p.cpu.id, `best cpu for ${page.gameId} (${p.label})`);
    }
  });

  it('every exported get*Picks recommender in src/lib is covered by this suite', () => {
    // A new recommender must be added here (with an eligibility assertion
    // above) before it can ship; this stops a buying pick from bypassing the
    // catalog audit unnoticed.
    const COVERED = new Set(['getTierPicks', 'getCpuGamePicks', 'getSffPicks', 'getBudgetPicks', 'getMotherboardPicks', 'getGamePicks']);
    const libDir = path.dirname(new URL(import.meta.url).pathname);
    const found = fs.readdirSync(libDir)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'))
      .flatMap((file) => [...fs.readFileSync(path.join(libDir, file), 'utf-8').matchAll(/export function (get\w*Picks)\b/g)].map((m) => m[1]));
    for (const name of found) expect(COVERED.has(name), `${name} is not covered by the eligibility suite`).toBe(true);
    expect(found.length).toBe(COVERED.size);
  });

  it('small-form-factor build picks', () => {
    for (const pick of getSffPicks()) {
      for (const part of [pick.gpu, pick.cpu, pick.motherboard, pick.cooler, pick.case]) expectRecommendable(part.id, 'sff');
    }
  });
});

describe('ordinary office builds use integrated graphics', () => {
  const office = getUseCase('home-office')!;
  const picks = getTierPicks(office);

  it('the two everyday tiers have no discrete GPU and a CPU with integrated graphics', () => {
    for (const pick of picks.filter((p) => p.tier.maxGpuPrice === null)) {
      expect(pick.gpu, pick.tier.label).toBeNull();
      expect(pick.cpu.integrated_graphics, pick.tier.label).toBeTruthy();
    }
    expect(picks.filter((p) => p.tier.maxGpuPrice === null).map((p) => p.tier.label)).toEqual(['Everyday Office', 'Power Multitasker']);
  });

  it('the light-creative tier still adds a discrete GPU', () => {
    const creative = picks.find((p) => p.tier.label === 'Hybrid Work + Light Creative')!;
    expect(creative.gpu).not.toBeNull();
  });
});
