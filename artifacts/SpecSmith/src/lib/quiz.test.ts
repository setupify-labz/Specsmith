import { describe, it, expect } from 'vitest';
import { getQuizResult, getQuizTiers } from './quiz';

describe('getQuizResult avgFps (gaming vs non-gaming)', () => {
  it('attaches a sane avgFps to every gaming tier result', () => {
    const tiers = getQuizTiers('gaming');
    expect(tiers.length).toBeGreaterThan(0);
    for (const t of tiers) {
      const result = getQuizResult('gaming', t.index);
      expect(result).not.toBeNull();
      expect(result!.avgFps).toBeDefined();
      expect(result!.avgFps).toBeGreaterThan(0);
      expect(result!.avgFps).toBeLessThan(999);
    }
  });

  it('a higher-budget gaming tier never estimates a lower avgFps than a cheaper tier', () => {
    const tiers = getQuizTiers('gaming');
    const fpsByTier = tiers.map(t => getQuizResult('gaming', t.index)!.avgFps!);
    for (let i = 1; i < fpsByTier.length; i++) {
      expect(fpsByTier[i]).toBeGreaterThanOrEqual(fpsByTier[i - 1]);
    }
  });

  it('does not attach avgFps to non-gaming use cases', () => {
    for (const slug of ['streaming', 'video-editing', 'ai-local-llm', 'home-office']) {
      const tiers = getQuizTiers(slug);
      expect(tiers.length).toBeGreaterThan(0);
      const result = getQuizResult(slug, 0);
      expect(result).not.toBeNull();
      expect(result!.avgFps).toBeUndefined();
    }
  });

  it('returns null for an out-of-range tier index', () => {
    expect(getQuizResult('gaming', 99)).toBeNull();
  });
});
