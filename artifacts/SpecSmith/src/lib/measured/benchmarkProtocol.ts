// Which segmentation rules a given game's benchmark is allowed to use.
//
// WHY THIS EXISTS
// ---------------
// Segmentation rules are not universally valid. `gpu-utilization-v1` excludes
// sustained stretches where the GPU was barely working, on the evidence that
// in Red Dead Redemption 2 those stretches are black loading screens between
// benchmark scenes. But sustained low GPU utilisation is ALSO what genuine
// CPU-bound gameplay looks like — a simulation-heavy strategy game, a busy
// multiplayer scene, a title that is simply CPU-limited on this hardware. The
// frame-level evidence is identical in both cases.
//
// So applying that rule generically would delete real benchmark footage and
// silently raise the reported frame rate, which is precisely the class of
// quiet error this system exists to prevent. A rule earns the right to run on
// a game only when there is evidence FOR THAT GAME that the pattern it keys on
// means what it assumes.
//
// WHAT COUNTS AS THAT EVIDENCE
// ----------------------------
// Each protocol records why every non-generic stage is admissible. For RDR2
// that is: an operator visually confirming the exact low-utilisation regions
// are black screens, the same structure recurring across two independent
// captures, both captures deriving an identical utilisation threshold from
// their own distributions, and the two runs agreeing to within 0.03% once
// segmented. A new game does not inherit any of that.
//
// DEFAULT IS THE CONSERVATIVE ONE
// -------------------------------
// A game with no registered protocol gets GENERIC_BENCHMARK_PROTOCOL, which
// permits only the structural presentation-path stage. Opting in is explicit,
// per game, and recorded in the observation.

/** Pinned identifier for the stage-1 rule. Changing the rule must change this string. */
export const PRESENTATION_PATH_STAGE = 'presentation-path-v1';

/** Pinned identifier for the stage-2 rule. */
export const GPU_UTILIZATION_STAGE = 'gpu-utilization-v1';

export type SegmentationStageId = typeof PRESENTATION_PATH_STAGE | typeof GPU_UTILIZATION_STAGE;

export const ALL_SEGMENTATION_STAGES: readonly SegmentationStageId[] = [
  PRESENTATION_PATH_STAGE,
  GPU_UTILIZATION_STAGE,
];

export interface BenchmarkProtocol {
  id: string;
  /** Bumped whenever the permitted stages or their justification change. */
  version: string;
  description: string;
  /** Stages this protocol permits, in the order they must run. */
  stages: readonly SegmentationStageId[];
  /** Why each stage beyond the generic one is admissible FOR THIS GAME. */
  justification: Partial<Record<SegmentationStageId, string>>;
}

/**
 * The default for any game with no protocol of its own.
 *
 * Permits only `presentation-path-v1`, which keys on how Windows composited
 * each frame rather than on anything about the game's workload. It cannot
 * mistake CPU-bound gameplay for a transition because it never looks at how
 * hard the machine was working — and when a capture does not have one clear
 * steady presentation path it refuses rather than guessing.
 */
export const GENERIC_BENCHMARK_PROTOCOL: BenchmarkProtocol = {
  id: 'generic-fullscreen',
  version: '1.0.0',
  description:
    'Default protocol. Removes only the fullscreen entry/exit edges, where the desktop compositor rather than the game paced the frames. No workload-based rule is applied, so sustained low GPU utilisation — which is what legitimate CPU-bound gameplay looks like — is always retained.',
  stages: [PRESENTATION_PATH_STAGE],
  justification: {
    [PRESENTATION_PATH_STAGE]:
      'Keys on PresentMode, a property of how the frame reached the screen rather than of the game\'s workload. A frame presented through the desktop compositor was not paced by the game whatever the game was doing.',
  },
};

/**
 * Red Dead Redemption 2's built-in benchmark.
 *
 * The only protocol currently opted into `gpu-utilization-v1`. Its built-in
 * benchmark plays a fixed sequence of scenes separated by black screens, and
 * during those the game presents at its 256 fps internal cap while rendering
 * essentially nothing. Because it never leaves exclusive fullscreen, the
 * presentation path does not change and stage 1 alone retains them.
 */
export const RDR2_BENCHMARK_PROTOCOL: BenchmarkProtocol = {
  id: 'rdr2-builtin-benchmark',
  version: '1.0.0',
  description:
    "Red Dead Redemption 2's built-in benchmark sequence: fixed scenes separated by black loading transitions, run in exclusive fullscreen.",
  stages: [PRESENTATION_PATH_STAGE, GPU_UTILIZATION_STAGE],
  justification: {
    [PRESENTATION_PATH_STAGE]:
      'The benchmark runs in exclusive fullscreen, so the compositor-paced head and tail are entry and exit rather than gameplay.',
    [GPU_UTILIZATION_STAGE]:
      'Admissible for this title on four independent pieces of evidence: (1) the operator visually confirmed the low-utilisation regions are black screens between benchmark scenes; (2) the same structure recurs in two independent captures of the same scene; (3) both captures derive an identical utilisation threshold from their own distributions, neither consulted about the other; (4) once segmented the two runs agree on average frame rate to within 0.03%, against 3.9% before. This evidence is specific to RDR2 and is NOT transferable — in a CPU-bound title the same frame-level pattern would be real gameplay.',
  },
};

/**
 * Games with a protocol of their own. Everything else gets the generic one.
 *
 * Keyed by SpecSmith catalog gameId. Adding an entry is a deliberate act that
 * should carry the evidence for it in `justification`.
 */
export const BENCHMARK_PROTOCOLS: Readonly<Record<string, BenchmarkProtocol>> = {
  rdr2: RDR2_BENCHMARK_PROTOCOL,
};

/** The protocol governing a game. Never throws: an unknown game is generic. */
export function protocolForGame(gameId: string): BenchmarkProtocol {
  return BENCHMARK_PROTOCOLS[gameId] ?? GENERIC_BENCHMARK_PROTOCOL;
}

export function protocolById(id: string): BenchmarkProtocol | undefined {
  if (id === GENERIC_BENCHMARK_PROTOCOL.id) return GENERIC_BENCHMARK_PROTOCOL;
  return Object.values(BENCHMARK_PROTOCOLS).find((p) => p.id === id);
}

/** Whether a protocol permits a stage. */
export function protocolAllowsStage(protocol: BenchmarkProtocol, stage: SegmentationStageId): boolean {
  return protocol.stages.includes(stage);
}

/**
 * What a saved observation records about how its frames were selected.
 *
 * Carries the protocol identity so a reader — and the store's validator — can
 * check that the rules applied were ones this game was allowed to use, rather
 * than trusting whatever produced the record.
 */
export interface SegmentationRecord {
  protocolId: string;
  protocolVersion: string;
  /** Every stage actually applied, in order. */
  stages: SegmentationStageId[];
  sourceSha256: string;
  retainedSha256: string;
  totalFrames: number;
  retainedFrames: number;
}
