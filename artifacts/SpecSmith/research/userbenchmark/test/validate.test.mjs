// Validation rule tests.
//
// The key property: data gaps are WARNINGs (ordinary research findings),
// structural impossibilities are ERRORs (tooling faults).

import { describe, it, assert } from './harness.mjs';
import * as V from '../lib/validate.mjs';

const errors = (is) => is.filter((i) => i.severity === V.SEVERITY.ERROR);
const warnings = (is) => is.filter((i) => i.severity === V.SEVERITY.WARNING);
const hasRule = (is, rule) => is.some((i) => i.rule === rule);

const goodGame = {
  gameId: '3954',
  name: 'Fortnite',
  canonicalUrl: 'https://www.userbenchmark.com/PCGame/FPS-Estimates-Fortnite/3954/0.0.0.0.0',
  averageFps: 96,
  totalSamples: 87737,
  hasFpsHistogram: true,
  hasSettingsDistribution: true,
  hasResolutionDistribution: true,
  gpuRowCount: 20,
  cpuRowCount: 20,
  provenance: { sourceFile: 'f.html' },
};

describe('Validate: games', () => {
  it('passes a well-formed game with no issues', () => {
    assert.equal(V.validateGames([goodGame]).length, 0);
  });
  it('errors on a non-numeric game id', () => {
    const is = V.validateGames([{ ...goodGame, gameId: 'abc' }]);
    assert.equal(errors(is).length, 1);
    assert.ok(hasRule(is, 'game.id-invalid'));
  });
  it('errors on a missing game id', () => {
    assert.ok(hasRule(V.validateGames([{ ...goodGame, gameId: null }]), 'game.id-invalid'));
  });
  it('errors on zero or negative average FPS', () => {
    assert.ok(hasRule(errors(V.validateGames([{ ...goodGame, averageFps: 0 }])), 'game.avg-fps-non-positive'));
    assert.ok(hasRule(errors(V.validateGames([{ ...goodGame, averageFps: -10 }])), 'game.avg-fps-non-positive'));
  });
  it('errors on an implausible FPS that suggests a parse error', () => {
    assert.ok(hasRule(errors(V.validateGames([{ ...goodGame, averageFps: 87737 }])), 'game.avg-fps-implausible'));
  });
  it('WARNS (not errors) on a missing average FPS — that is a data gap', () => {
    const is = V.validateGames([{ ...goodGame, averageFps: null }]);
    assert.equal(errors(is).length, 0, 'a missing value is not a tooling fault');
    assert.ok(hasRule(warnings(is), 'game.avg-fps-missing'));
  });
  it('WARNS on missing charts rather than failing the run', () => {
    const is = V.validateGames([{ ...goodGame, hasFpsHistogram: false, hasSettingsDistribution: false, hasResolutionDistribution: false }]);
    assert.equal(errors(is).length, 0);
    assert.equal(warnings(is).length, 3);
  });
  it('errors on a negative sample count', () => {
    assert.ok(hasRule(errors(V.validateGames([{ ...goodGame, totalSamples: -1 }])), 'game.samples-negative'));
  });
});

describe('Validate: component observations', () => {
  const goodGpu = {
    gameId: '3954',
    componentName: 'Nvidia GTX 1060-6GB',
    componentPageUrl: 'https://gpu.userbenchmark.com/Nvidia-GTX-1060-6GB/Rating/3639',
    samples: 6210,
    benchPercent: 24,
    valuePercent: 51,
    unresolvedFilterPositions: [],
    provenance: { sourceFile: 'f.html' },
  };

  it('passes a well-formed GPU row', () => {
    assert.equal(V.validateComponentObservations([goodGpu], 'gpu').length, 0);
  });
  it('errors when a row is classified as GPU but links to the CPU subdomain', () => {
    const is = V.validateComponentObservations([{ ...goodGpu, componentPageUrl: 'https://cpu.userbenchmark.com/x/Rating/1' }], 'gpu');
    assert.ok(hasRule(errors(is), 'gpu.domain-mismatch'), 'a misclassified row is a tooling fault');
  });
  it('errors on a missing component name', () => {
    assert.ok(hasRule(errors(V.validateComponentObservations([{ ...goodGpu, componentName: '' }], 'gpu')), 'gpu.name-missing'));
  });
  it('errors on a negative sample count', () => {
    assert.ok(hasRule(errors(V.validateComponentObservations([{ ...goodGpu, samples: -5 }], 'gpu')), 'gpu.samples-negative'));
  });
  it('WARNS on a missing sample count', () => {
    const is = V.validateComponentObservations([{ ...goodGpu, samples: null }], 'gpu');
    assert.equal(errors(is).length, 0);
    assert.ok(hasRule(warnings(is), 'gpu.samples-missing'));
  });
  it('WARNS when a filter path uses an undocumented position', () => {
    const is = V.validateComponentObservations([{ ...goodGpu, unresolvedFilterPositions: [{ index: 2, value: '7' }] }], 'gpu');
    assert.equal(errors(is).length, 0, 'an undocumented field is a research finding, not a fault');
    assert.ok(hasRule(warnings(is), 'gpu.filter-position-unresolved'));
  });
});

describe('Validate: EFPS direct', () => {
  const good = { gameId: '3954', exactTitle: 'Fortnite 3600 2060S', fps: 131, gpu: '2060S', cpu: '3600', efpsUrl: 'u1', unresolvedFields: [], warnings: [], provenance: {} };

  it('passes a well-formed record', () => {
    assert.equal(V.validateEfpsDirect([good]).length, 0);
  });
  it('errors on zero, negative, or implausible FPS', () => {
    assert.ok(hasRule(errors(V.validateEfpsDirect([{ ...good, fps: 0 }])), 'efps.fps-non-positive'));
    assert.ok(hasRule(errors(V.validateEfpsDirect([{ ...good, fps: -1 }])), 'efps.fps-non-positive'));
    assert.ok(hasRule(errors(V.validateEfpsDirect([{ ...good, fps: 99999 }])), 'efps.fps-implausible'));
  });
  it('errors when the same EFPS URL reports two different FPS values', () => {
    const is = V.validateEfpsDirect([good, { ...good, fps: 140 }]);
    assert.ok(hasRule(errors(is), 'efps.same-url-different-fps'));
  });
  it('WARNS on a missing GPU or CPU token', () => {
    const is = V.validateEfpsDirect([{ ...good, gpu: null }]);
    assert.equal(errors(is).length, 0);
    assert.ok(hasRule(warnings(is), 'efps.gpu-missing'));
  });
  it('WARNS when the undocumented EFPS field 3 is populated', () => {
    const is = V.validateEfpsDirect([{ ...good, unresolvedFields: [{ group: 3, field: 3, value: 'z' }] }]);
    assert.equal(errors(is).length, 0);
    assert.ok(hasRule(warnings(is), 'efps.unresolved-field'));
  });
});

describe('Validate: EFPS comparisons', () => {
  const good = {
    gameId: '3954',
    exactTitle: 'Fortnite 5700-XT vs 1660-Ti - 9400F',
    sides: [
      { label: '5700-XT', fps: 137, gpu: '5700-XT', cpu: '9400F', resolvedVariant: 'B', variantResolvedByTokenMatch: true },
      { label: '1660-Ti', fps: 108, gpu: '1660-Ti', cpu: '9400F', resolvedVariant: 'A', variantResolvedByTokenMatch: true },
    ],
    warnings: [],
    provenance: {},
  };

  it('passes a well-formed comparison', () => {
    assert.equal(V.validateEfpsComparisons([good]).length, 0);
  });
  it('errors when a comparison does not have exactly two sides', () => {
    assert.ok(hasRule(errors(V.validateEfpsComparisons([{ ...good, sides: [good.sides[0]] }])), 'efps-cmp.side-count'));
  });
  it('errors when both sides resolve to the same URL variant', () => {
    const bad = { ...good, sides: [{ ...good.sides[0], resolvedVariant: 'A' }, { ...good.sides[1], resolvedVariant: 'A' }] };
    assert.ok(hasRule(errors(V.validateEfpsComparisons([bad])), 'efps-cmp.same-variant-both-sides'));
  });
  it('errors on an invalid side FPS', () => {
    const bad = { ...good, sides: [{ ...good.sides[0], fps: 0 }, good.sides[1]] };
    assert.ok(hasRule(errors(V.validateEfpsComparisons([bad])), 'efps-cmp.side-fps-invalid'));
  });
  it('WARNS when a side could not be matched to a URL variant', () => {
    const bad = { ...good, sides: [{ ...good.sides[0], variantResolvedByTokenMatch: false, resolvedVariant: null }, good.sides[1]] };
    const is = V.validateEfpsComparisons([bad]);
    assert.equal(errors(is).length, 0);
    assert.ok(hasRule(warnings(is), 'efps-cmp.variant-unresolved'));
  });
});

describe('Validate: EFPS cross-check', () => {
  const direct = [{ gameId: '1', gpu: '2060S', cpu: '3600', fps: 131 }];

  it('agrees when a comparison side matches its direct record', () => {
    const cmp = [{ gameId: '1', exactTitle: 't', sides: [{ label: '2060S', gpu: '2060S', cpu: '3600', fps: 131 }] }];
    const r = V.crossValidateEfps(direct, cmp);
    assert.equal(r.stats.checked, 1);
    assert.equal(r.stats.agreed, 1);
    assert.equal(r.issues.length, 0);
  });

  it('ERRORS when a comparison side contradicts its direct record', () => {
    const cmp = [{ gameId: '1', exactTitle: 't', sides: [{ label: '2060S', gpu: '2060S', cpu: '3600', fps: 999 }] }];
    const r = V.crossValidateEfps(direct, cmp);
    assert.equal(r.stats.mismatched, 1);
    assert.ok(hasRule(errors(r.issues), 'efps.cross-check-mismatch'), 'a contradiction means the decoding is wrong');
  });

  it('skips sides with no matching direct record instead of inventing one', () => {
    const cmp = [{ gameId: '1', exactTitle: 't', sides: [{ label: 'x', gpu: 'unknown', cpu: 'unknown', fps: 50 }] }];
    const r = V.crossValidateEfps(direct, cmp);
    assert.equal(r.stats.checked, 0);
    assert.equal(r.issues.length, 0);
  });
});

describe('Validate: distributions and configurations', () => {
  it('errors when labels and data lengths differ', () => {
    const is = V.validateDistributions([{ gameId: '1', distribution: 'settings', labelCount: 4, dataCount: 3, lengthsMatch: false, data: [], provenance: {} }]);
    assert.ok(hasRule(errors(is), 'dist.length-mismatch'));
  });
  it('errors on a negative distribution value', () => {
    const is = V.validateDistributions([{ gameId: '1', distribution: 'settings', labelCount: 2, dataCount: 2, lengthsMatch: true, data: [5, -1], provenance: {} }]);
    assert.ok(hasRule(errors(is), 'dist.negative-value'));
  });
  it('WARNS on an empty distribution', () => {
    const is = V.validateDistributions([{ gameId: '1', distribution: 'settings', labelCount: 0, dataCount: 0, lengthsMatch: true, data: [], provenance: {} }]);
    assert.equal(errors(is).length, 0);
    assert.ok(hasRule(warnings(is), 'dist.empty'));
  });
  it('errors when a filter path is not 5 positions', () => {
    const is = V.validateConfigurations([{ gameId: '1', rawFilterPath: '1.2', positions: ['1', '2'], unresolvedPositions: [], provenance: {} }]);
    assert.ok(hasRule(errors(is), 'config.arity'));
  });
  it('WARNS on an unresolved filter position', () => {
    const is = V.validateConfigurations([{ gameId: '1', rawFilterPath: '0.0.7.0.0', positions: ['0', '0', '7', '0', '0'], unresolvedPositions: [{ index: 2, value: '7' }], provenance: {} }]);
    assert.equal(errors(is).length, 0);
    assert.ok(hasRule(warnings(is), 'config.unresolved-position'));
  });
});

describe('Validate: summarize', () => {
  it('counts errors and warnings separately', () => {
    const s = V.summarize([
      { severity: 'error', rule: 'a', message: '' },
      { severity: 'warning', rule: 'b', message: '' },
      { severity: 'warning', rule: 'b', message: '' },
    ]);
    assert.equal(s.total, 3);
    assert.equal(s.errors, 1);
    assert.equal(s.warnings, 2);
    assert.equal(s.byRule['warning:b'], 2);
  });
});
