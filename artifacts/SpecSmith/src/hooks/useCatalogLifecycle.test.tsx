// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';

import { useCatalogLifecycle } from './useCatalogLifecycle';
import * as staticLifecycle from '../lib/catalogLifecycle';

afterEach(cleanup);

describe('useCatalogLifecycle', () => {
  it('starts fail-closed and then answers exactly like the static module', async () => {
    const { result } = renderHook(() => useCatalogLifecycle());
    // Nothing is eligible before the list arrives: callers see null.
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).not.toBeNull());
    for (const id of ['rtx5070', 'rtx3060', 'rtx4050', 'cmh212', 'not-a-part']) {
      expect(result.current!.isRecommendable(id), id).toBe(staticLifecycle.isRecommendable(id));
      expect(result.current!.catalogLabelText(id), id).toBe(staticLifecycle.catalogLabelText(id));
    }
  });
});
