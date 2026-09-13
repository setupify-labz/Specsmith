// @vitest-environment jsdom
//
// The invitation to run the estimator used to read "Your selected GPU and CPU
// have supported specifications." That is a claim about the two products the
// shopper picked, and when one of them is a retailer listing nothing has
// measured it. What the estimator actually has is a MAPPING from each
// selection to a model it supports — enough for an estimate, and not a
// specification. See src/lib/retail/partIdentity.ts.

import { describe, expect, it } from 'vitest';
import { cleanup, render, within } from '@testing-library/react';
import RetailEstimateAction from './RetailEstimateAction';

describe('the estimator invitation claims a mapping, not a specification', () => {
  it('names the mapping and labels the result as an estimate for the model', () => {
    const { container } = render(<RetailEstimateAction canEstimate onEstimate={() => {}} />);
    const help = within(container).getByText(/estimator supports/i);
    expect(help.textContent).not.toMatch(/have supported specifications/i);
    expect(help.textContent).toMatch(/estimated for the model, not measured from these exact products/i);
  });

  it('still refuses to guess when a selection has no mapping', () => {
    cleanup();
    const { container } = render(<RetailEstimateAction canEstimate={false} onEstimate={() => {}} />);
    expect(within(container).getByText(/we will not guess their performance/i)).toBeTruthy();
    expect((within(container).getByRole('button', { name: /estimate fps/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
