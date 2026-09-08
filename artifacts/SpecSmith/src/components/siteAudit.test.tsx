// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import CompatibilityBanner from './CompatibilityBanner';
import RetailEstimateAction from './builder/RetailEstimateAction';

afterEach(cleanup);

it('does not claim compatibility success before any checks ran', () => {
  render(<CompatibilityBanner warnings={[]} passed={[]} />);
  expect(screen.getByText(/Compatibility not checked yet/)).toBeTruthy();
  expect(screen.queryByText(/All checks passed|No compatibility issues/)).toBeNull();
});

it('limits success to the constraints actually checked', () => {
  render(<CompatibilityBanner warnings={[]} passed={['CPU socket']} />);
  expect(screen.getByText(/Checked constraints passed: CPU socket/)).toBeTruthy();
  expect(screen.getByText(/may remain unchecked/)).toBeTruthy();
});

it('prevents estimation for unsupported selections', () => {
  const onEstimate = vi.fn();
  render(<RetailEstimateAction canEstimate={false} onEstimate={onEstimate} />);
  fireEvent.click(screen.getByRole('button', { name: 'Estimate FPS' }));
  expect(onEstimate).not.toHaveBeenCalled();
  expect(screen.getByText(/will not guess/)).toBeTruthy();
});

it('opens estimation for a supported selection', () => {
  const onEstimate = vi.fn();
  render(<RetailEstimateAction canEstimate onEstimate={onEstimate} />);
  fireEvent.click(screen.getByRole('button', { name: 'Estimate FPS' }));
  expect(onEstimate).toHaveBeenCalledOnce();
});
