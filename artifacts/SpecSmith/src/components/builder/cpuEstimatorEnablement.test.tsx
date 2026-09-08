// @vitest-environment jsdom
//
// Issue #101, requirement 7: a supported retail CPU beside a supported GPU must
// enable the existing FPS estimate, and that estimate must read as Estimated.
//
// These drive the real components, not a reimplementation of the builder's
// gate, so they fail if the copy or the disabled behaviour changes.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';

import cpuData from '../../data/cpus.json';
import gpuData from '../../data/gpus.json';
import gameData from '../../data/games.json';
import FpsEstimator from '../FpsEstimator';
import RetailEstimateAction from './RetailEstimateAction';

afterEach(cleanup);

const cpus = cpuData as any[];
const gpus = gpuData as any[];
const games = gameData as any[];

describe('the estimate action states plainly whether a pair is supported', () => {
  it('is disabled, and says it will not guess, when no supported pair is selected', () => {
    render(<RetailEstimateAction canEstimate={false} onEstimate={vi.fn()} />);
    const button = screen.getByRole('button', { name: /estimate fps/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(document.body.textContent).toContain('we will not guess their performance');
  });

  it('is enabled once both parts resolve to supported specifications', () => {
    render(<RetailEstimateAction canEstimate onEstimate={vi.fn()} />);
    const button = screen.getByRole('button', { name: /estimate fps/i }) as HTMLButtonElement;
    expect(button.disabled).toBe(false);
    expect(document.body.textContent).toContain('supported specifications');
  });
});

describe('the estimate it produces never reads as a measurement', () => {
  it('labels the i5-13400F result Estimated, not measured', () => {
    const cpu = cpus.find((c) => c.id === 'i5-13400f');
    const gpu = gpus.find((g) => typeof g.gpu_multiplier === 'number');
    expect(cpu, 'canonical i5-13400f missing').toBeTruthy();
    expect(gpu, 'no canonical GPU with a multiplier').toBeTruthy();

    render(
      <FpsEstimator
        gpu={gpu}
        cpu={cpu}
        games={games}
        resolution="1080p"
        preset="high"
        onResolutionChange={vi.fn()}
        onPresetChange={vi.fn()}
      />,
    );

    expect(document.body.textContent).toContain('Estimated — not measured');
  });
});
