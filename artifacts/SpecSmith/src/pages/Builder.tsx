import { useEffect, useState, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Link, useSearchParams } from 'react-router-dom';
import PartSelector from '../components/PartSelector';
import BuildSummary from '../components/BuildSummary';
import CompatibilityBanner from '../components/CompatibilityBanner';
import FpsEstimator from '../components/FpsEstimator';
import VerifiedBenchmarkPanel from '../components/VerifiedBenchmarkPanel';
import { useBuilder, type BuildState } from '../hooks/useBuilder';
import { checkCompatibility } from '../lib/compatibility';
import { decodeBuild } from '../lib/sharing';
import gpuData from '../data/gpus.json';
import cpuData from '../data/cpus.json';
import componentData from '../data/components.json';
import gamesData from '../data/games.json';
import peripheralData from '../data/peripherals.json';
import { ArrowRight, ChevronDown, Monitor as MonitorIcon, Sparkles } from 'lucide-react';
import { useSeo } from '../hooks/useSeo';
import { getRouteMeta } from '../lib/seo';
import { useAffiliatePartCatalog } from '../hooks/useAffiliatePartCatalog';
import { useProductImageManifest } from '../hooks/useProductImageManifest';
import {
  compatibilityView,
  hasVerifiedIdentity,
  type SelectionOrigin,
} from '../lib/retail/partIdentity';
import RetailBuilder from '../components/builder/RetailBuilder';
import BuilderSkeleton from '../components/builder/BuilderSkeleton';
import {
  importedRecommendations,
  recognisedPartIds,
  type CanonicalPartRef,
} from '../lib/retail/importedBuild';
import {
  CATALOGUE_PENDING,
  CORE_BUILD_TOTAL,
  catalogueComplete,
  cataloguePartial,
  coreCategoryAction,
  coreReplacementAction,
  describeCoreBuild,
  type CatalogueKnowledge,
} from '../lib/retail/coreBuild';
import CatalogFailureNotice from '../components/builder/CatalogFailureNotice';
import type { AffiliatePart, RetailPartCategory } from '../lib/retail/partCatalog';

type Resolution = '1080p' | '1440p' | '4k';
type Preset = 'low' | 'medium' | 'high' | 'ultra';

const VALID_RESOLUTIONS: Resolution[] = ['1080p', '1440p', '4k'];
const VALID_PRESETS: Preset[] = ['low', 'medium', 'high', 'ultra'];

interface GPU { id: string; name: string; brand: string; series: string; price_usd: number; tier: number; vram_gb: number; tdp_watts: number; architecture: string; release_year: number; benchmark_score: number; gpu_multiplier: number; sponsored?: boolean; [key: string]: unknown; }
interface CPU { id: string; name: string; brand: string; series: string; price_usd: number; tier: number; cores: number; threads: number; base_ghz: number; boost_ghz: number; tdp_watts: number; socket: string; supported_ram: string[]; release_year: number; benchmark_score: number; cpu_multiplier: number; sponsored?: boolean; [key: string]: unknown; }
interface Motherboard { id: string; name: string; brand: string; price_usd: number; socket: string; supported_ram: string[]; form_factor: string; sponsored?: boolean; [key: string]: unknown; }
interface RAM { id: string; name: string; brand: string; price_usd: number; type: string; capacity_gb: number; speed_mhz: number; sponsored?: boolean; [key: string]: unknown; }
interface Storage { id: string; name: string; brand: string; price_usd: number; type: string; capacity_tb: number; speed_mbs: number; sponsored?: boolean; [key: string]: unknown; }
interface PSU { id: string; name: string; brand: string; price_usd: number; wattage: number; rating: string; sponsored?: boolean; [key: string]: unknown; }
interface Case { id: string; name: string; brand: string; price_usd: number; form_factor: string; motherboard_support: string[]; sponsored?: boolean; [key: string]: unknown; }
interface Cooler { id: string; name: string; brand: string; price_usd: number; type: string; max_tdp_watts: number; sponsored?: boolean; [key: string]: unknown; }
interface Monitor { id: string; name: string; brand: string; price_usd: number; size_inches: number; resolution: string; panel_type: string; refresh_rate_hz: number; response_time_ms: number; hdr: boolean | string; g_sync: boolean | string; freesync: boolean; release_year: number; [key: string]: unknown; }
interface Keyboard { id: string; name: string; brand: string; price_usd: number; switch_type: string; form_factor: string; rgb: boolean; wireless: boolean; release_year: number; [key: string]: unknown; }
interface Mouse { id: string; name: string; brand: string; price_usd: number; dpi_max: number; weight_grams: number; wireless: boolean; rgb: boolean; buttons: number; release_year: number; [key: string]: unknown; }
interface Headset { id: string; name: string; brand: string; price_usd: number; driver_mm: number; surround_sound: string; wireless: boolean; noise_cancelling: boolean; microphone: boolean; release_year: number; [key: string]: unknown; }
interface Game { id: string; name: string; genre: string; year: number; gpu_bound?: number; base_fps: Record<Resolution, Record<Preset, number>>; [key: string]: unknown; }

const gpus = gpuData as GPU[];
const cpus = cpuData as CPU[];
const games = gamesData as Game[];

const builderFaqs = [
  {
    title: 'How does the PC build FPS calculator work?',
    content: 'It maps the selected GPU and CPU to SpecSmith\'s supported hardware models, then estimates FPS for the game, resolution, and quality preset you choose. The result is a planning estimate, not a measurement of the exact products in your cart. Drivers, game patches, cooling, memory, and background software can change real performance. Where SpecSmith has a cited measured benchmark for the selected configuration, it is shown separately as a verified benchmark.',
  },
  {
    title: 'Can I test a PC build before buying it?',
    content: 'You can evaluate a planned build before buying by checking supported compatibility rules, reviewing its known-price subtotal, and estimating game performance. This is not a remote benchmark or stress test of hardware you already own, and it cannot guarantee that every exact product fits. Confirm unverified dimensions, connectors, BIOS support, and current availability with the manufacturers and retailers before ordering.',
  },
  {
    title: 'Can I add a part that isn\'t in the list?',
    content: 'Yes — use "Add Custom Part" in the build summary to enter any component by name and price so it\'s included in your total cost. Custom parts don\'t have benchmark data in our dataset, so they won\'t affect the FPS estimate or compatibility checks — those still run on the tracked GPU and CPU you\'ve selected.',
  },
  {
    title: 'Does the total price include sales tax?',
    content: 'No, prices exclude sales tax by default. The build summary has an optional field where you can enter your local tax rate to see an estimated with-tax total — nothing is added automatically since rates vary by location.',
  },
  {
    title: 'What do the compatibility warnings actually mean?',
    content: 'Each warning explains the rule that triggered it, a suggested fix, and its confidence. A certain warning comes from the structured specifications available to that check; a likely warning depends on incomplete or model-level information. Compatibility coverage is not exhaustive, so no warning is a promise that every unmentioned detail is compatible. Confirm exact dimensions, connectors, and BIOS support before ordering.',
  },
];

function builderFaqJsonLd() {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: builderFaqs.map((f) => ({
      '@type': 'Question',
      name: f.title,
      acceptedAnswer: { '@type': 'Answer', text: f.content },
    })),
  };
}

function getResolutionTier(res: string): number {
  if (res === '4K' || res === '5120x1440p') return 4;
  if (res === '3440x1440p' || res === '1440p') return 2;
  return 1;
}

export default function Builder() {
  useSeo(getRouteMeta('/builder'));
  const [searchParams] = useSearchParams();
  const [peripheralsOpen, setPeripheralsOpen] = useState(false);
  const { view: affiliateCatalog, retry: retryCatalog } = useAffiliatePartCatalog();
  const processedImages = useProductImageManifest();

  const retailByCategory = useMemo(() => {
    const grouped = new Map<RetailPartCategory, AffiliatePart[]>();
    if (affiliateCatalog.status !== 'ok') return grouped;
    for (const part of affiliateCatalog.catalog.parts) {
      const list = grouped.get(part.category) ?? [];
      list.push(part);
      grouped.set(part.category, list);
    }
    return grouped;
  }, [affiliateCatalog]);

  // Canonical parts ONLY. They are the source of FPS estimates, compatibility
  // rules and specifications, and they are what a legacy saved build names.
  // They are no longer concatenated with retailer SKUs: a canonical row beside
  // a real listing carries a hand-maintained price and a placeholder image,
  // which is what produced the "RTX 5090 — $3,979" card. The shopping grid is
  // fed from the affiliate catalogue instead.
  const builderGpus = useMemo<GPU[]>(
    () => gpus.map((gpu) => ({ ...gpu, image: `/images/gpus/${gpu.id}.png`, specsVerified: true })),
    [],
  );

  const builderCpus = useMemo<CPU[]>(() => cpus.map((part) => ({ ...part, specsVerified: true })), []);

  const canonicalOnly = <T extends { id: string }>(canonical: T[]): T[] =>
    canonical.map((part) => ({ ...part, specsVerified: true }));

  const builderMotherboards = useMemo(() => canonicalOnly(componentData.motherboards as Motherboard[]), []);
  const builderRam = useMemo(() => canonicalOnly(componentData.ram as RAM[]), []);
  const builderStorage = useMemo(() => canonicalOnly(componentData.storage as Storage[]), []);
  const builderPsus = useMemo(() => canonicalOnly(componentData.psus as PSU[]), []);
  const builderCases = useMemo(() => canonicalOnly(componentData.cases as Case[]), []);
  const builderCoolers = useMemo(() => canonicalOnly(componentData.coolers as Cooler[]), []);
  const builderMonitors = useMemo(() => canonicalOnly(peripheralData.monitors as Monitor[]), []);
  const builderKeyboards = useMemo(() => canonicalOnly(peripheralData.keyboards as Keyboard[]), []);
  const builderMice = useMemo(() => canonicalOnly(peripheralData.mice as Mouse[]), []);
  const builderHeadsets = useMemo(() => canonicalOnly(peripheralData.headsets as Headset[]), []);

  /**
   * Every retailer SKU by id, plus the canonical part each verified SKU maps to.
   *
   * This is the internal bridge: choosing an exact listing still produces a
   * canonical GPU or CPU for the FPS estimator and the compatibility checker.
   * The canonical part informs those calculations and never becomes a second
   * selectable product in the grid. A SKU with no verified mapping resolves to
   * null, and the estimate is withheld rather than guessed.
   */
  const retailById = useMemo(() => {
    const map = new Map<string, AffiliatePart>();
    if (affiliateCatalog.status === 'ok') for (const part of affiliateCatalog.catalog.parts) map.set(part.id, part);
    return map;
  }, [affiliateCatalog]);

  /**
   * The canonical part behind a selection, and WHERE the selection came from.
   *
   * The origin is the point. A canonical id names a model, and the model's
   * figures describe it. A retail listing names one box on a shelf, and the
   * model's figures do not describe that box — its length and power draw
   * depend on which board partner built it.
   *
   * Keyed on `canonicalPartId` rather than on `specsVerified`: the mapping is
   * an identity finding from the model matcher, and gating it on a
   * specifications flag conflated the two questions this split exists to
   * separate.
   */
  const resolveWithOrigin = <T extends { id: string }>(
    list: T[],
    id: string | null,
  ): { part: T | null; origin: SelectionOrigin } => {
    if (!id) return { part: null, origin: 'canonical' };
    const direct = list.find((part) => part.id === id);
    if (direct) return { part: direct, origin: 'canonical' };
    const sku = retailById.get(id);
    const canonicalId = sku && hasVerifiedIdentity(sku) ? sku.canonicalPartId : null;
    const part = canonicalId ? list.find((entry) => entry.id === canonicalId) ?? null : null;
    return { part, origin: 'retail-listing' };
  };

  const resolveCanonical = <T extends { id: string }>(list: T[], id: string | null): T | null =>
    resolveWithOrigin(list, id).part;

  // Parse initial state from URL params (from prebuilts "Load into Builder" or share link)
  const initialBuild = useMemo(() => {
    const b = searchParams.get('b');
    if (b) {
      const decoded = decodeBuild(decodeURIComponent(b));
      if (decoded) return decoded.build as Partial<BuildState>;
    }
    const keys: (keyof BuildState)[] = ['gpu','cpu','motherboard','ram','storage','psu','case','cooler','monitor','keyboard','mouse','headset'];
    const fromParams: Partial<BuildState> = {};
    let hasAny = false;
    keys.forEach(k => {
      const v = searchParams.get(k);
      if (v) { fromParams[k] = v; hasAny = true; }
    });
    return hasAny ? fromParams : undefined;
  }, []);

  const { build, selectPart, loadBuild, clearBuild } = useBuilder(initialBuild);
  const [showFps, setShowFps] = useState(false);
  const [fpsResolution, setFpsResolution] = useState<Resolution>('1080p');
  const [fpsPreset, setFpsPreset] = useState<Preset>('high');
  const [customParts, setCustomParts] = useState<{ id: string; name: string; price: number }[]>([]);
  const addCustomPart = (name: string, price: number) =>
    setCustomParts(list => [...list, { id: `custom-${Date.now()}`, name, price }]);
  const removeCustomPart = (id: string) =>
    setCustomParts(list => list.filter(p => p.id !== id));
  const startOver = () => {
    clearBuild();
    setCustomParts([]);
    setShowFps(false);
  };
  const importBuild = (imported: { build: Record<string, string | null>; view: { resolution: string; preset: string } | null; customParts: { name: string; price: number }[] }) => {
    loadBuild(imported.build);
    if (imported.view
      && (VALID_RESOLUTIONS as string[]).includes(imported.view.resolution)
      && (VALID_PRESETS as string[]).includes(imported.view.preset)) {
      setFpsResolution(imported.view.resolution as Resolution);
      setFpsPreset(imported.view.preset as Preset);
    }
    setCustomParts(imported.customParts.map((cp, i) => ({ id: `custom-${Date.now()}-${i}`, name: cp.name, price: cp.price })));
    setShowFps(false);
  };
  const [recommendedIds, setRecommendedIds] = useState<string[]>([]);

  /**
   * The ids the builder currently on screen can actually show.
   *
   * Counted from the SELECTION rather than from what the estimator can
   * resolve — but a slot only counts if something can go in it. A saved SKU
   * that has dropped out of the catalogue is skipped by the build summary,
   * so counting it here would say "8 of 8" over a summary listing seven:
   * the same contradiction, arriving from the other side.
   *
   * Which ids are showable depends on which builder is up. The retail
   * builder draws from the catalogue; the canonical fallback draws from the
   * reference parts. While the catalogue is still loading the answer is not
   * known yet — and there is no summary on screen to contradict — so the
   * shopper's own selections stand until it is.
   */
  /**
   * Every canonical core model the site knows, by id.
   *
   * This is what makes an imported build legible. Guides, the quiz, Build
   * Crate, shared links and saved builds all hand `/builder` canonical model
   * ids, and the retail builder recognises only exact SKUs — so Budget Beast
   * arrived as eight ids and displayed as nothing at all.
   */
  /**
   * Every canonical model the site knows, by id — ALL TWELVE CATEGORIES.
   *
   * This is what makes an imported build legible. Guides, the quiz, Build
   * Crate, shared links and saved builds all hand `/builder` canonical model
   * ids, and the retail builder recognises only exact SKUs — so Budget Beast
   * arrived as eight ids and displayed as nothing at all.
   *
   * PERIPHERALS ARE IN HERE TOO. They arrive through exactly the same links a
   * core part does, and a monitor dropped because it is "only" a peripheral is
   * still a part that vanished on arrival. What stays core-only is the
   * PROGRESS BAR, which counts the eight parts that make a computer — a
   * headset does not make the machine more complete, and the eight-slot rule
   * that PR #111 settled is not reopened here.
   */
  const canonicalById = useMemo<ReadonlyMap<string, CanonicalPartRef>>(() => {
    const index = new Map<string, CanonicalPartRef>();
    for (const part of [
      ...builderGpus, ...builderCpus, ...builderMotherboards, ...builderRam,
      ...builderStorage, ...builderPsus, ...builderCases, ...builderCoolers,
      ...builderMonitors, ...builderKeyboards, ...builderMice, ...builderHeadsets,
    ] as { id: string; name: string; price_usd?: number }[]) {
      index.set(part.id, {
        id: part.id,
        name: part.name,
        // An editorial estimate, kept under a name that says so. It never
        // becomes a retailer price and never reaches the retailer subtotal.
        ...(typeof part.price_usd === 'number' ? { estimatedPrice: part.price_usd } : {}),
      });
    }
    return index;
  }, [
    builderGpus, builderCpus, builderMotherboards, builderRam,
    builderStorage, builderPsus, builderCases, builderCoolers,
    builderMonitors, builderKeyboards, builderMice, builderHeadsets,
  ]);

  const retailIds = useMemo<ReadonlySet<string>>(
    () =>
      affiliateCatalog.status === 'ok'
        ? new Set(affiliateCatalog.catalog.parts.map((part) => part.id))
        : new Set<string>(),
    [affiliateCatalog],
  );

  /**
   * The recommendations a shopper arrived with and has not yet replaced.
   *
   * Nothing here matches a model to a listing. One model has several distinct
   * SKUs at different prices, and choosing one on the shopper's behalf would
   * invent a purchase decision — see importedBuild.ts.
   */
  const imported = useMemo(
    () => importedRecommendations(build, retailIds, canonicalById),
    [build, retailIds, canonicalById],
  );

  /**
   * What this page is actually entitled to say about a saved id.
   *
   * The three cases are NOT interchangeable, and treating the third as the
   * second was a defect: on a failed download every saved retailer SKU was
   * classified as missing, so the page told the shopper both "live listings
   * could not be loaded" and "your processor is no longer available". The
   * second sentence is not something a failed HTTP request can establish.
   *
   * - loading  → nothing is knowable yet.
   * - ok       → exact listings AND recognised models, so the counter and the
   *              summary describe the same set, including a build that
   *              arrived from elsewhere. An id in neither is genuinely not in
   *              our catalogue.
   * - failed   → canonical parts are bundled with the app, so those are still
   *              knowable and still count. A retailer SKU cannot be checked
   *              against a catalogue that never arrived, so it is left
   *              unchecked rather than condemned.
   */
  const catalogueKnowledge = useMemo<CatalogueKnowledge>(() => {
    if (affiliateCatalog.status === 'loading') return CATALOGUE_PENDING;
    if (affiliateCatalog.status === 'ok') {
      return catalogueComplete(recognisedPartIds(retailIds, canonicalById));
    }
    return cataloguePartial(new Set(canonicalById.keys()));
  }, [affiliateCatalog, retailIds, canonicalById]);

  // ONE reading of the build, shared by every surface that describes it — the
  // counter here, the cart, the desktop rail and the mobile chips. They drifted
  // apart by being derived three different ways in three different files.
  const core = describeCoreBuild(build, catalogueKnowledge);

  /**
   * Sends the shopper to a category, and says so out loud.
   *
   * The retail builder owns which category is open, so this asks for one by
   * bumping a token rather than by reaching in: the same category can be
   * requested twice in a row and still register. The canonical fallback has no
   * category rail, so there the request is honoured by scrolling to the
   * builder region instead of silently doing nothing.
   */
  const [categoryRequest, setCategoryRequest] = useState<{ category: RetailPartCategory; token: number } | null>(null);
  const builderRegionRef = useRef<HTMLDivElement | null>(null);
  const handleChooseCategory = (category: RetailPartCategory) => {
    setCategoryRequest((current) => ({ category, token: (current?.token ?? 0) + 1 }));
  };

  /**
   * Brings the requested category into view.
   *
   * ONLY the retail builder is handled here. The canonical fallback's selector
   * scrolls to itself once it has opened — see PartSelector — because opening
   * changes the page height, and a scroll aimed from outside while the panel is
   * still collapsed targets an offset that ceases to exist and is abandoned by
   * the browser. The component that changes size is the one that can say when
   * it has finished changing.
   */
  useEffect(() => {
    if (!categoryRequest) return;
    if (builderRegionRef.current?.querySelector('[data-part-section]')) return;
    builderRegionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [categoryRequest]);

  /** Opens the fallback's selector for a category when it is the one requested. */
  const openSignalFor = (category: RetailPartCategory) =>
    categoryRequest?.category === category ? categoryRequest.token : undefined;

  const gpuSectionRef = useRef<HTMLDivElement>(null);
  const cpuSectionRef = useRef<HTMLDivElement>(null);
  const fpsSectionRef = useRef<HTMLDivElement>(null);

  const selectedGpu = resolveCanonical(builderGpus, build.gpu);
  const selectedCpu = resolveCanonical(builderCpus, build.cpu);
  const selectedMb = resolveCanonical(builderMotherboards, build.motherboard);
  const selectedRam = resolveCanonical(builderRam, build.ram);
  const selectedStorage = resolveCanonical(builderStorage, build.storage);
  const selectedPsu = resolveCanonical(builderPsus, build.psu);
  const selectedCase = resolveCanonical(builderCases, build.case);
  const selectedCooler = resolveCanonical(builderCoolers, build.cooler);
  // Only the GPU carries per-unit figures the checker uses today (length and
  // power). The origin is tracked here so the withholding is visible at the
  // call site rather than buried in the view helper.
  const gpuOrigin = resolveWithOrigin(builderGpus, build.gpu).origin;
  const selectedMonitor = resolveCanonical(builderMonitors, build.monitor);
  const selectedKeyboard = resolveCanonical(builderKeyboards, build.keyboard);
  const selectedMouse = resolveCanonical(builderMice, build.mouse);
  const selectedHeadset = resolveCanonical(builderHeadsets, build.headset);

  const compat = useMemo(() => {
    const result = checkCompatibility({
      // GENERIC MODEL FIGURES MAY NOT DECIDE AN EXACT LISTING'S FIT. For a
      // retail SKU the canonical record's length and TDP are withheld, so the
      // clearance and power checks do not run rather than running on a
      // measurement of a different object. The FPS estimator below still gets
      // the full canonical part, because it models the chip.
      gpu: compatibilityView(selectedGpu, gpuOrigin),
      cpu: selectedCpu, motherboard: selectedMb, ram: selectedRam,
      psu: selectedPsu, case: selectedCase, cooler: selectedCooler,
    });
    // Monitor pairing warnings
    if (selectedMonitor && selectedGpu && typeof selectedMonitor.resolution === 'string' && typeof selectedMonitor.refresh_rate_hz === 'number' && typeof selectedGpu.tier === 'number') {
      const res = selectedMonitor.resolution;
      const hz = selectedMonitor.refresh_rate_hz;
      const tier = selectedGpu.tier;
      if ((res === '4K' || res === '5120x1440p') && tier < 7) {
        result.warnings.push({
          id: 'monitor-4k', type: 'warning', confidence: 'likely',
          title: 'GPU may struggle at this monitor\'s resolution',
          detail: `${selectedMonitor.name} is ${res}, which is demanding — ${selectedGpu.name} will need lowered settings or upscaling to keep smooth frame rates there.`,
          fix: 'Consider a stronger GPU, a 1440p monitor, or plan on using DLSS/FSR.',
        });
      } else if (getResolutionTier(res) >= 2 && tier < 5) {
        result.warnings.push({
          id: 'monitor-1440p', type: 'warning', confidence: 'likely',
          title: 'GPU may struggle at 1440p on this monitor',
          detail: `${selectedGpu.name} is an entry-level card for ${res} — expect medium settings in demanding games.`,
          fix: 'A mid-tier or better GPU pairs more comfortably with this monitor.',
        });
      }
      if (hz >= 360 && tier < 8) {
        result.warnings.push({
          id: 'monitor-refresh', type: 'warning', confidence: 'likely',
          title: `GPU won't feed this ${hz}Hz monitor in most games`,
          detail: `${hz}Hz only pays off when the GPU can produce ${hz}+ FPS — realistic for esports titles on this card, but not in demanding games.`,
          fix: 'Fine if you mainly play esports titles; otherwise a high-end GPU makes better use of this panel.',
        });
      }
    }
    return result;
    // `gpuOrigin` is a dependency in its own right. Switching from the canonical
    // rtx5070 to a retail listing OF an rtx5070 leaves `selectedGpu` at the same
    // object, so an identity-based dep list would keep the canonical result —
    // and go on reporting a clearance verdict that must no longer be made.
  }, [selectedGpu, gpuOrigin, selectedCpu, selectedMb, selectedRam, selectedPsu, selectedCase, selectedCooler, selectedMonitor]);
  const warnings = compat.warnings;
  const monitorWarningCount = warnings.filter(w => w.id.startsWith('monitor-')).length;

  const corePartsList = [
    selectedGpu     && { label: 'GPU',         name: selectedGpu.name,     price: selectedGpu.price_usd, affiliateUrl: selectedGpu.affiliateUrl as string | undefined },
    selectedCpu     && { label: 'CPU',         name: selectedCpu.name,     price: selectedCpu.price_usd, affiliateUrl: selectedCpu.affiliateUrl as string | undefined },
    selectedMb      && { label: 'Motherboard', name: selectedMb.name,      price: selectedMb.price_usd, affiliateUrl: selectedMb.affiliateUrl as string | undefined },
    selectedRam     && { label: 'RAM',         name: selectedRam.name,     price: selectedRam.price_usd, affiliateUrl: selectedRam.affiliateUrl as string | undefined },
    selectedStorage && { label: 'Storage',     name: selectedStorage.name, price: selectedStorage.price_usd, affiliateUrl: selectedStorage.affiliateUrl as string | undefined },
    selectedPsu     && { label: 'PSU',         name: selectedPsu.name,     price: selectedPsu.price_usd, affiliateUrl: selectedPsu.affiliateUrl as string | undefined },
    selectedCase    && { label: 'Case',        name: selectedCase.name,    price: selectedCase.price_usd, affiliateUrl: selectedCase.affiliateUrl as string | undefined },
    selectedCooler  && { label: 'Cooler',      name: selectedCooler.name,  price: selectedCooler.price_usd, affiliateUrl: selectedCooler.affiliateUrl as string | undefined },
  ].filter(Boolean) as { label: string; name: string; price?: number; affiliateUrl?: string }[];

  const peripheralPartsList = [
    selectedMonitor  && { label: 'Monitor',  name: selectedMonitor.name,  price: selectedMonitor.price_usd, affiliateUrl: selectedMonitor.affiliateUrl as string | undefined },
    selectedKeyboard && { label: 'Keyboard', name: selectedKeyboard.name, price: selectedKeyboard.price_usd, affiliateUrl: selectedKeyboard.affiliateUrl as string | undefined },
    selectedMouse    && { label: 'Mouse',    name: selectedMouse.name,    price: selectedMouse.price_usd, affiliateUrl: selectedMouse.affiliateUrl as string | undefined },
    selectedHeadset  && { label: 'Headset',  name: selectedHeadset.name,  price: selectedHeadset.price_usd, affiliateUrl: selectedHeadset.affiliateUrl as string | undefined },
  ].filter(Boolean) as { label: string; name: string; price?: number; affiliateUrl?: string }[];

  const summaryParts = [
    ...corePartsList,
    ...peripheralPartsList,
    ...customParts.map(cp => ({ label: 'Custom', name: cp.name, price: cp.price, customId: cp.id })),
  ];
  const totalCost = summaryParts.reduce((sum, p) => sum + (p.price ?? 0), 0);
  const canEstimate = Boolean(
    selectedGpu && selectedCpu &&
    typeof selectedGpu.gpu_multiplier === 'number' && Number.isFinite(selectedGpu.gpu_multiplier) &&
    typeof selectedCpu.cpu_multiplier === 'number' && Number.isFinite(selectedCpu.cpu_multiplier),
  );

  const buildState: Record<string, string | null> = {
    gpu: build.gpu, cpu: build.cpu,
    motherboard: build.motherboard, ram: build.ram,
    storage: build.storage, psu: build.psu,
    case: build.case, cooler: build.cooler,
    monitor: build.monitor ?? null,
    keyboard: build.keyboard ?? null,
    mouse: build.mouse ?? null,
    headset: build.headset ?? null,
  };

  const handleEstimateFps = () => {
    setShowFps(true);
    // Wait a tick so the FPS section has mounted before scrolling to it —
    // scrolls every time the button is clicked, not just the first.
    requestAnimationFrame(() => {
      fpsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const handleScrollToGpu = () => {
    gpuSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    // Highlight top GPUs
    if (selectedCpu) {
      const top3 = typeof selectedCpu.benchmark_score === 'number'
        ? gpus.filter(g => g.benchmark_score >= selectedCpu.benchmark_score * 0.72).slice(0, 3).map(g => g.id)
        : [];
      setRecommendedIds(top3);
      setTimeout(() => setRecommendedIds([]), 3500);
    }
  };
  const handleScrollToCpu = () => {
    cpuSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    if (selectedGpu) {
      const top3 = cpus.filter(c => c.benchmark_score >= selectedGpu.benchmark_score / 1.4).slice(0, 3).map(c => c.id);
      setRecommendedIds(top3);
      setTimeout(() => setRecommendedIds([]), 3500);
    }
  };

  return (
    <div className="min-h-screen pt-24 pb-20" style={{ backgroundColor: 'var(--ff-bg)' }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(builderFaqJsonLd()) }} />
      <div className="ff-builder-shell px-4 sm:px-6 lg:px-8">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          <h1 className="text-3xl sm:text-4xl font-black mb-2" style={{ color: 'var(--ff-text)' }}>
            PC Build <span className="gradient-text">Calculator</span>
          </h1>
          <p className="text-sm sm:text-base max-w-3xl mb-2 leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>
            Choose PC parts, total current listing prices, check supported compatibility rules, and estimate gaming FPS across 20 games at 1080p, 1440p, or 4K.
          </p>
          <p className="text-xs mb-4" style={{ color: 'var(--ff-text-3)' }}>
            Free to use · No account required · Estimates are clearly separated from measured benchmarks
          </p>

          {core.settled && core.count === 0 && (
            <Link to="/quiz" className="inline-flex items-center gap-1.5 text-xs font-semibold mb-4 hover:opacity-80"
              style={{ color: 'var(--ff-accent-text)' }}>
              <Sparkles size={12} /> Not sure where to start? Take the 2-question PC Build Quiz →
            </Link>
          )}

          {/* HOW MUCH OF A COMPUTER IS CHOSEN — and nothing else.
              This counted resolved canonical parts, which meant it counted
              only listings whose specs are verified. One core category is
              verified in the published catalogue, so choosing a CPU and a
              motherboard moved it not at all: the summary said three parts and
              this said one.

              It counts the slots the live catalogue can fill by exact id,
              which is the test the cart applies too. WHILE THE CATALOGUE IS IN
              FLIGHT it states no number at all: an unchecked draft is not a
              finished build, and a bar reading "8 of 8" before anything has
              looked at a single saved id is a guess that happens to be right
              most days. Whether a part's specs are verified, and whether the
              build is compatible, remain different questions with their own
              places on this page, and both stay fail-closed. */}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="flex items-center gap-3" style={{ minWidth: '16rem', maxWidth: '20rem', flex: '1 1 16rem' }}>
              <div
                className="flex-1 h-1.5 rounded-full overflow-hidden"
                style={{ backgroundColor: 'var(--ff-border)' }}
                role="progressbar"
                // Busy ONLY while something is actually in flight: a bar
                // marked busy after a failed download announces work that
                // will never finish. Then it is indeterminate, not loading.
                {...(core.settled
                  ? { 'aria-valuenow': core.count }
                  : catalogueKnowledge.status === 'pending'
                    ? { 'aria-busy': true }
                    : {})}
                aria-valuemin={0}
                aria-valuemax={CORE_BUILD_TOTAL}
                aria-label={core.label}
              >
                <motion.div
                  className="h-full rounded-full"
                  style={{ background: 'linear-gradient(90deg, var(--ff-accent), var(--ff-cyan))' }}
                  initial={{ width: 0 }}
                  animate={{ width: core.settled ? `${(core.count / CORE_BUILD_TOTAL) * 100}%` : '0%' }}
                  transition={{ duration: 0.4, ease: 'easeOut' }}
                />
              </div>
              {/* The label is the accessible name of the bar beside it, so a
                  screen reader is not told the same number twice. */}
              <span
                aria-hidden="true"
                data-testid="core-progress"
                className="text-xs font-semibold whitespace-nowrap"
                style={{ color: 'var(--ff-text-2)' }}
              >
                {core.label}
              </span>
            </div>

            {/* Never offered from an unchecked draft. Both paths wire the
                request through to the named selector, so it is safe on each. */}
            {core.next !== null && (
              <button
                type="button"
                data-testid="next-core-part"
                data-category={core.next}
                data-slot={core.slots[core.next]}
                onClick={() => handleChooseCategory(core.next!)}
                className="ff-accent-control inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold"
                style={{ color: 'var(--ff-accent-text)', border: '1px solid var(--ff-border)' }}
              >
                {core.slots[core.next] === 'unavailable'
                  ? coreReplacementAction(core.next)
                  : coreCategoryAction(core.next)}
                <ArrowRight size={12} aria-hidden="true" />
              </button>
            )}
          </div>

          {/* ONE sentence for every category that needs replacing, not one
              per part. Without it the cart is simply a row short and the
              shopper is left to work out why. */}
          {core.notice !== null && (
            <p
              data-testid="stale-core-parts"
              role="status"
              className="mt-2 text-xs font-medium"
              style={{ color: 'var(--ff-amber)' }}
            >
              {core.notice}
            </p>
          )}
        </motion.div>

        <div className="mb-6">
          <CompatibilityBanner warnings={warnings} passed={compat.passed} skipped={compat.skipped} />
        </div>

        <div ref={builderRegionRef}>
        {affiliateCatalog.status === 'ok' ? (
          /* THE SHOPPING INTERFACE. Fed exclusively from the 500-part retailer
             catalogue: exact SKUs, each with its own image, price, tracked link
             and price timestamp. Canonical parts are not passed in, so they
             cannot appear as products — they stay behind the scenes powering
             the FPS estimate and compatibility check above. */
          <RetailBuilder
            estimate={{ canEstimate, onEstimate: handleEstimateFps }}
            parts={affiliateCatalog.catalog.parts}
            selection={build}
            onSelect={(category, id) => {
              selectPart(category as keyof BuildState, id);
              if (category === 'gpu' || category === 'cpu') setShowFps(false);
            }}
            processedImages={processedImages}
            categoryRequest={categoryRequest}
            imported={imported}
          />
        ) : affiliateCatalog.status === 'loading' ? (
          /* STILL LOADING — NOT A FAILURE (issue #104). This branch used to
             not exist, and loading fell through to the canonical fallback
             below, so every ordinary visit painted the legacy builder and then
             replaced it. The skeleton holds the retail layout's shape until
             the real thing arrives, and claims nothing about any product. */
          <BuilderSkeleton />
        ) : (
          /* A CONFIRMED FAILURE, and only that. The fetch answered and there
             was no usable catalogue — the request failed, the file is missing,
             or what came back did not parse. Fall back to the canonical parts
             so the builder still works offline, and say so with a way to try
             again. These carry editorial estimates, which is why they are
             labelled as such and never mixed with retailer pricing. */
          <>
            <CatalogFailureNotice view={affiliateCatalog} onRetry={retryCatalog} />
            <div data-testid="canonical-fallback">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Part selectors */}
            <div className="lg:col-span-2 space-y-3">
              {/* GPU */}
              <div ref={gpuSectionRef}>
                <PartSelector
                  openSignal={openSignalFor('gpu')} category="gpu" label="GPU — Graphics Card" defaultOpen
                  parts={builderGpus}
                  selectedId={build.gpu}
                  recommendedIds={recommendedIds}
                  onSelect={id => { selectPart('gpu', id); setShowFps(false); }}
                  getSpecs={p => {
                    if (p.specsVerified === false) return [{ label: 'Specs', value: 'Not verified' }];
                    const g = p as GPU;
                    return [
                      { label: 'VRAM', value: `${g.vram_gb}GB ${g.architecture}` },
                      { label: 'TDP', value: `${g.tdp_watts}W` },
                      { label: 'Release', value: String(g.release_year) },
                    ];
                  }}
                />
              </div>
              {/* CPU */}
              <div ref={cpuSectionRef}>
                <PartSelector
                  openSignal={openSignalFor('cpu')} category="cpu" label="CPU — Processor"
                  parts={builderCpus}
                  selectedId={build.cpu}
                  recommendedIds={recommendedIds}
                  onSelect={id => { selectPart('cpu', id); setShowFps(false); }}
                  getSpecs={p => {
                    if (p.specsVerified === false) return [{ label: 'Specs', value: 'Not verified' }];
                    const c = p as CPU;
                    return [
                      { label: 'Cores/Threads', value: `${c.cores}C / ${c.threads}T` },
                      { label: 'Boost', value: `${c.boost_ghz}GHz` },
                      { label: 'Socket', value: `${c.socket} · ${c.supported_ram.join('/')}` },
                    ];
                  }}
                />
              </div>
              <PartSelector openSignal={openSignalFor('motherboard')} category="motherboard" label="Motherboard"
                parts={builderMotherboards} selectedId={build.motherboard}
                onSelect={id => selectPart('motherboard', id)}
                getSpecs={p => { if (p.specsVerified === false) return [{ label: 'Specs', value: 'Not verified' }]; const m = p as Motherboard; return [{ label: 'Socket', value: m.socket }, { label: 'RAM', value: m.supported_ram.join(' / ') }, { label: 'Form Factor', value: m.form_factor }]; }}
              />
              <PartSelector openSignal={openSignalFor('ram')} category="ram" label="RAM — Memory"
                parts={builderRam} selectedId={build.ram}
                onSelect={id => selectPart('ram', id)}
                getSpecs={p => { if (p.specsVerified === false) return [{ label: 'Specs', value: 'Not verified' }]; const r = p as RAM; return [{ label: 'Type', value: r.type }, { label: 'Capacity', value: `${r.capacity_gb}GB` }, { label: 'Speed', value: `${r.speed_mhz}MHz` }]; }}
              />
              <PartSelector openSignal={openSignalFor('storage')} category="storage" label="Storage"
                parts={builderStorage} selectedId={build.storage}
                onSelect={id => selectPart('storage', id)}
                getSpecs={p => { if (p.specsVerified === false) return [{ label: 'Specs', value: 'Not verified' }]; const s = p as Storage; return [{ label: 'Type', value: s.type }, { label: 'Capacity', value: `${s.capacity_tb}TB` }, { label: 'Speed', value: `${s.speed_mbs}MB/s` }]; }}
              />
              <PartSelector openSignal={openSignalFor('psu')} category="psu" label="PSU — Power Supply"
                parts={builderPsus} selectedId={build.psu}
                onSelect={id => selectPart('psu', id)}
                getSpecs={p => { if (p.specsVerified === false) return [{ label: 'Specs', value: 'Not verified' }]; const psu = p as PSU; return [{ label: 'Wattage', value: `${psu.wattage}W` }, { label: 'Rating', value: psu.rating }]; }}
              />
              <PartSelector openSignal={openSignalFor('case')} category="case" label="Case"
                parts={builderCases} selectedId={build.case}
                onSelect={id => selectPart('case', id)}
                getSpecs={p => { if (p.specsVerified === false) return [{ label: 'Specs', value: 'Not verified' }]; const c = p as Case; return [{ label: 'Form Factor', value: c.form_factor }, { label: 'Supports', value: c.motherboard_support.join(', ') }]; }}
              />
              <PartSelector openSignal={openSignalFor('cooler')} category="cooler" label="CPU Cooler"
                parts={builderCoolers} selectedId={build.cooler}
                onSelect={id => selectPart('cooler', id)}
                getSpecs={p => { if (p.specsVerified === false) return [{ label: 'Specs', value: 'Not verified' }]; const c = p as Cooler; return [{ label: 'Type', value: c.type }, { label: 'Max TDP', value: `${c.max_tdp_watts}W` }]; }}
              />

              {/* Peripherals section */}
              <div
                className="rounded-2xl overflow-hidden"
                style={{
                  border: monitorWarningCount > 0 && !peripheralsOpen ? '1px solid var(--ff-amber)' : '1px solid var(--ff-border)',
                  backgroundColor: 'var(--ff-surface)',
                  boxShadow: peripheralsOpen ? '0 8px 24px -8px rgba(108,99,255,0.18)' : 'none',
                }}
              >
                <button
                  onClick={() => setPeripheralsOpen(!peripheralsOpen)}
                  className="w-full flex items-center justify-between p-4 text-sm font-semibold transition-colors"
                  style={{ color: 'var(--ff-text)', backgroundColor: peripheralsOpen ? 'var(--ff-card-hover)' : 'var(--ff-surface)' }}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className="flex-shrink-0 w-9 h-9 rounded-xl flex items-center justify-center relative"
                      style={{ backgroundColor: 'var(--ff-card)', border: '1px solid var(--ff-border)' }}
                    >
                      <MonitorIcon size={16} style={{ color: 'var(--ff-text-2)' }} />
                      {monitorWarningCount > 0 && !peripheralsOpen && (
                        <span
                          className="absolute -top-1 -right-1 w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold text-black"
                          style={{ backgroundColor: 'var(--ff-amber)' }}
                          aria-hidden="true"
                        >
                          {monitorWarningCount}
                        </span>
                      )}
                    </div>
                    <div className="text-left">
                      <span>Peripherals <span className="text-xs font-normal ml-1" style={{ color: 'var(--ff-text-2)' }}>(optional)</span></span>
                      <p className="text-xs font-normal mt-0.5" style={{ color: monitorWarningCount > 0 && !peripheralsOpen ? 'var(--ff-amber)' : 'var(--ff-text-3)' }}>
                        {monitorWarningCount > 0 && !peripheralsOpen
                          ? `${monitorWarningCount} monitor pairing note${monitorWarningCount > 1 ? 's' : ''} — open to review`
                          : 'Pairing a monitor checks it against your GPU — also Keyboard, Mouse, Headset'}
                      </p>
                    </div>
                  </div>
                  <ChevronDown size={18} className={`transition-transform duration-300 ${peripheralsOpen ? 'rotate-180' : ''}`} style={{ color: 'var(--ff-text-2)' }} />
                </button>
                <AnimatePresence>
                  {peripheralsOpen && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3 }}
                      className="overflow-hidden"
                    >
                      <div className="p-3 space-y-2" style={{ borderTop: '1px solid var(--ff-border)', backgroundColor: 'var(--ff-bg)' }}>
                        <PartSelector category="monitor" label="Monitor"
                          parts={builderMonitors} selectedId={build.monitor}
                          onSelect={id => selectPart('monitor', id)}
                          getSpecs={p => { if (p.specsVerified === false) return [{ label: 'Specs', value: 'Not verified' }]; const m = p as Monitor; return [{ label: 'Resolution', value: m.resolution }, { label: 'Refresh Rate', value: `${m.refresh_rate_hz}Hz` }, { label: 'Panel', value: m.panel_type }]; }}
                        />
                        <PartSelector category="keyboard" label="Keyboard"
                          parts={builderKeyboards} selectedId={build.keyboard}
                          onSelect={id => selectPart('keyboard', id)}
                          getSpecs={p => { if (p.specsVerified === false) return [{ label: 'Specs', value: 'Not verified' }]; const k = p as Keyboard; return [{ label: 'Switch', value: k.switch_type }, { label: 'Form', value: k.form_factor }, { label: 'Wireless', value: k.wireless ? 'Yes' : 'No' }]; }}
                        />
                        <PartSelector category="mouse" label="Mouse"
                          parts={builderMice} selectedId={build.mouse}
                          onSelect={id => selectPart('mouse', id)}
                          getSpecs={p => { if (p.specsVerified === false) return [{ label: 'Specs', value: 'Not verified' }]; const m = p as Mouse; return [{ label: 'DPI', value: `${m.dpi_max.toLocaleString()}` }, { label: 'Weight', value: `${m.weight_grams}g` }, { label: 'Wireless', value: m.wireless ? 'Yes' : 'No' }]; }}
                        />
                        <PartSelector category="headset" label="Headset"
                          parts={builderHeadsets} selectedId={build.headset}
                          onSelect={id => selectPart('headset', id)}
                          getSpecs={p => { if (p.specsVerified === false) return [{ label: 'Specs', value: 'Not verified' }]; const h = p as Headset; return [{ label: 'Driver', value: `${h.driver_mm}mm` }, { label: 'Surround', value: h.surround_sound }, { label: 'Wireless', value: h.wireless ? 'Yes' : 'No' }]; }}
                        />
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Right panel */}
            <div className="lg:col-span-1 space-y-6">
              <BuildSummary
                parts={summaryParts}
                totalCost={totalCost}
                onEstimateFps={handleEstimateFps}
                canEstimate={canEstimate}
                compatibilityOk={warnings.filter(w => w.type === 'error').length === 0}
                gpu={selectedGpu}
                cpu={selectedCpu}
                buildState={buildState}
                shareView={{ resolution: fpsResolution, preset: fpsPreset }}
                customParts={customParts}
                onAddCustomPart={addCustomPart}
                onRemoveCustomPart={removeCustomPart}
                onScrollToGpu={handleScrollToGpu}
                onScrollToCpu={handleScrollToCpu}
                onStartOver={startOver}
                onImportBuild={importBuild}
              />
            </div>
          </div>

          </div>
          </>
        )}
        </div>

        {/* FPS Estimator */}
        <div ref={fpsSectionRef}>
          <AnimatePresence>
            {showFps && selectedGpu && selectedCpu && (
              <FpsEstimator
                gpu={selectedGpu} cpu={selectedCpu} games={games}
                resolution={fpsResolution} preset={fpsPreset}
                onResolutionChange={setFpsResolution} onPresetChange={setFpsPreset}
              />
            )}
          </AnimatePresence>
          <AnimatePresence>
            {showFps && selectedGpu && selectedCpu && (
              <VerifiedBenchmarkPanel
                gpuId={selectedGpu.id} gpuName={selectedGpu.name}
                cpuId={selectedCpu.id} cpuName={selectedCpu.name}
              />
            )}
          </AnimatePresence>
        </div>

        <section className="mt-12" aria-labelledby="calculator-checks-heading">
          <h2 id="calculator-checks-heading" className="text-xl font-black mb-4" style={{ color: 'var(--ff-text)' }}>
            What this PC build calculator checks
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="rounded-xl p-4" style={{ border: '1px solid var(--ff-border)', backgroundColor: 'var(--ff-surface)' }}>
              <h3 className="font-bold text-sm mb-1.5" style={{ color: 'var(--ff-text)' }}>Parts and known prices</h3>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>
                Build around eight core component categories. Current retailer price observations are totaled when available and fresh; missing or stale prices are excluded instead of replaced with an invented current price.
              </p>
            </div>
            <div className="rounded-xl p-4" style={{ border: '1px solid var(--ff-border)', backgroundColor: 'var(--ff-surface)' }}>
              <h3 className="font-bold text-sm mb-1.5" style={{ color: 'var(--ff-text)' }}>Supported compatibility rules</h3>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>
                Check supported socket, memory, form-factor, power, and clearance rules when the required specifications exist. Coverage is not exhaustive, so confirm every exact product's specifications before ordering.
              </p>
            </div>
            <div className="rounded-xl p-4" style={{ border: '1px solid var(--ff-border)', backgroundColor: 'var(--ff-surface)' }}>
              <h3 className="font-bold text-sm mb-1.5" style={{ color: 'var(--ff-text)' }}>Estimated game FPS</h3>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>
                Compare estimated performance across 20 games, three resolutions, and four quality presets for supported GPU and CPU models. Estimates are planning guidance—not results measured from your computer.
              </p>
            </div>
          </div>
        </section>

        <section className="mt-8 space-y-3" aria-labelledby="builder-faq-heading">
          <h2 id="builder-faq-heading" className="text-xl font-black mb-4" style={{ color: 'var(--ff-text)' }}>
            PC build calculator questions
          </h2>
          {builderFaqs.map((f) => (
            <div key={f.title} className="rounded-xl p-4" style={{ border: '1px solid var(--ff-border)', backgroundColor: 'var(--ff-surface)' }}>
              <h3 className="font-bold text-sm mb-1.5" style={{ color: 'var(--ff-text)' }}>{f.title}</h3>
              <p className="text-xs leading-relaxed" style={{ color: 'var(--ff-text-2)' }}>{f.content}</p>
            </div>
          ))}
        </section>
      </div>
    </div>
  );
}
