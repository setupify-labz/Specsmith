import { expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import RetailBuilder from '../../components/builder/RetailBuilder';
import { detectIdentityConflict } from './identityConflict';
import { loadAffiliatePartCatalog } from './partCatalogLoader';
import catalog from '../../../public/data/retail-parts.json';

const link = (path: string) => `https://click.linksynergy.com/link?id=test&offerid=test&murl=${encodeURIComponent(`https://www.newegg.com/${path}/p/N82E16814137980`)}`;

it.each([
  ['MSI Gaming GeForce RTX 5050 RTX 5050 8G GAMING OC', 'msi-rtx-5060-8g-gaming-oc', 'gpu-model-conflict'],
  ['RTX 4060 Ti 8GB', 'geforce-rtx-4060-8gb', 'gpu-model-conflict'],
  ['Radeon RX 7900 XTX', 'radeon-rx-7900-xt', 'gpu-model-conflict'],
  ['GIGABYTE RTX 5060 GAMING OC GV-N5060GAMING OCV2-8GD WINDFORCE cooling', 'gigabyte-windforce-gv-n5060wf2oc-8gd-geforce-rtx-5060', 'gpu-variant-conflict'],
])('rejects contradictory identity: %s', (name, path, reason) => {
  expect(detectIdentityConflict(name, link(path))).toBe(reason);
});

it.each([
  ['MSI RTX 5060 GAMING OC', 'msi-rtx-5060-gaming-oc'],
  ['GIGABYTE GV-N5060GAMING OCV2-8GD WINDFORCE cooling', 'gigabyte-gv-n5060gaming-ocv2-8gd'],
  ['RTX 4070 Ti Super', 'rtx-4070-ti-super'],
])('does not reject consistent tokens (not independent verification): %s', (name, path) => {
  expect(detectIdentityConflict(name, link(path))).toBeNull();
});

it('does not infer identity from missing slugs or query text', () => {
  expect(detectIdentityConflict('RTX 5050', 'invalid')).toBeNull();
  expect(detectIdentityConflict('RTX 5050', link('product') + '&search=RTX5060')).toBeNull();
});

it('quarantines conflicting published rows, including images, prices and mappings', async () => {
  const fixture = structuredClone(catalog);
  fixture.parts[0].name = 'Review fixture MSI Gaming GeForce RTX 5050 Graphics Card RTX 5050 8G GAMING OC';
  fixture.parts[0].trackedAffiliateUrl = link('msi-rtx-5060-8g-gaming-oc');
  const expected = fixture.parts.filter(p => detectIdentityConflict(p.name, p.trackedAffiliateUrl));
  expect(expected.some(p => p.name.includes('RTX 5050 8G GAMING OC'))).toBe(true);
  const view = await loadAffiliatePartCatalog({ fetch: async () => new Response(JSON.stringify(fixture)) });
  expect(view.status).toBe('ok');
  if (view.status !== 'ok') throw new Error('Expected parsed catalogue');
  expect(view.quarantined).toHaveLength(expected.length);
  expect(view.catalog.parts).toHaveLength(catalog.parts.length - expected.length);
  const markup = renderToStaticMarkup(createElement(RetailBuilder, {
    parts: view.catalog.parts, selection: { gpu: fixture.parts[0].id }, onSelect: () => {},
  }));
  expect(markup).not.toContain('RTX 5050 8G GAMING OC');
  expect(markup).toContain('Your build (0)');
  for (const part of expected) {
    expect(view.catalog.parts.find(p => p.id === part.id)).toBeUndefined();
    expect(view.quarantined).toContainEqual({ partId: part.id, reason: detectIdentityConflict(part.name, part.trackedAffiliateUrl) });
  }
});
