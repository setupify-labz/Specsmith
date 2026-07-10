export const SITE_URL = 'https://frameforge.app';
export const SITE_NAME = 'SpecSmith';
export const DEFAULT_OG_IMAGE = `${SITE_URL}/opengraph.jpg`;

export interface RouteMeta {
  path: string;
  title: string;
  description: string;
  image?: string;
  noindex?: boolean;
  canonicalOverride?: string;
}

export const ROUTE_META: RouteMeta[] = [
  {
    path: '/',
    title: 'SpecSmith — Free PC Builder & FPS Estimator',
    description:
      'Build a compatible gaming PC and see estimated FPS across 20 games before you buy. Pick from 50+ GPUs and 50+ CPUs with live compatibility checks and real pricing.',
  },
  {
    path: '/builder',
    title: 'PC Builder + FPS Estimator | SpecSmith',
    description:
      'Pick your GPU, CPU, motherboard, RAM, storage, PSU, case, and cooler. Get instant compatibility checks and estimated FPS in 20 games at 1080p, 1440p, and 4K.',
  },
  {
    path: '/prebuilts',
    title: 'Prebuilt Gaming PCs — 5 Curated Builds | SpecSmith',
    description:
      'Browse five curated, ready-to-buy PC builds across budget, 1080p, 1440p, and 4K tiers, each with estimated FPS and total cost. Load any build straight into the Builder.',
  },
  {
    path: '/compare',
    title: 'Compare PC Builds Side-by-Side | SpecSmith',
    description:
      'Compare two PC builds head-to-head with FPS and price charts. See exactly which configuration gives you more performance per dollar before you buy.',
  },
  {
    path: '/about',
    title: 'How SpecSmith Estimates FPS | About',
    description:
      'Learn how SpecSmith\u2019s tier-based algorithm estimates gaming FPS from GPU and CPU benchmark data, and how we check socket, RAM, and PSU compatibility.',
  },
  {
    path: '/build',
    title: 'Shared Build — SpecSmith',
    description:
      'View a PC build shared from SpecSmith, including parts, estimated FPS across popular games, and total cost. Open it in the Builder to customize it yourself.',
    noindex: true,
    canonicalOverride: `${SITE_URL}/builder`,
  },
];

export function getRouteMeta(path: string): RouteMeta {
  return (
    ROUTE_META.find((r) => r.path === path) ?? {
      path,
      title: `${SITE_NAME}`,
      description:
        'SpecSmith is a free PC Builder and FPS Estimator for planning compatible gaming PCs.',
    }
  );
}

export interface PrebuiltMetaInput {
  id: string;
  name: string;
  tagline: string;
  description: string;
  target_resolution: string;
  estimated_price: number;
}

export function getPrebuiltMeta(prebuilt: PrebuiltMetaInput): RouteMeta {
  return {
    path: `/prebuilts/${prebuilt.id}`,
    title: `${prebuilt.name} — ${prebuilt.target_resolution} Gaming PC | SpecSmith`,
    description: `${prebuilt.tagline}. ${prebuilt.description} Estimated total: $${prebuilt.estimated_price.toLocaleString()}. See full parts list and FPS benchmarks.`,
  };
}

export function buildHeadTags(meta: RouteMeta): string {
  const url = meta.canonicalOverride ?? `${SITE_URL}${meta.path === '/' ? '/' : meta.path}`;
  const image = meta.image ?? DEFAULT_OG_IMAGE;
  const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `
    <title>${escape(meta.title)}</title>
    <meta name="description" content="${escape(meta.description)}" />
    ${meta.noindex ? '<meta name="robots" content="noindex, follow" />' : ''}
    <link rel="canonical" href="${url}" />
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="${SITE_NAME}" />
    <meta property="og:title" content="${escape(meta.title)}" />
    <meta property="og:description" content="${escape(meta.description)}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:image" content="${image}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escape(meta.title)}" />
    <meta name="twitter:description" content="${escape(meta.description)}" />
    <meta name="twitter:image" content="${image}" />`;
}

export function applyClientMeta(meta: RouteMeta) {
  if (typeof document === 'undefined') return;
  const url = meta.canonicalOverride ?? `${SITE_URL}${meta.path === '/' ? '/' : meta.path}`;
  const image = meta.image ?? DEFAULT_OG_IMAGE;

  document.title = meta.title;

  let robots = document.head.querySelector<HTMLMetaElement>('meta[name="robots"]');
  if (meta.noindex) {
    if (!robots) {
      robots = document.createElement('meta');
      robots.setAttribute('name', 'robots');
      document.head.appendChild(robots);
    }
    robots.setAttribute('content', 'noindex, follow');
  } else if (robots) {
    robots.remove();
  }

  const setMeta = (selector: string, create: () => HTMLMetaElement, content: string) => {
    let el = document.head.querySelector<HTMLMetaElement>(selector);
    if (!el) {
      el = create();
      document.head.appendChild(el);
    }
    el.setAttribute('content', content);
  };

  setMeta('meta[name="description"]', () => {
    const el = document.createElement('meta');
    el.setAttribute('name', 'description');
    return el;
  }, meta.description);

  let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.setAttribute('rel', 'canonical');
    document.head.appendChild(canonical);
  }
  canonical.setAttribute('href', url);

  const ogTags: [string, string][] = [
    ['og:type', 'website'],
    ['og:site_name', SITE_NAME],
    ['og:title', meta.title],
    ['og:description', meta.description],
    ['og:url', url],
    ['og:image', image],
  ];
  for (const [property, content] of ogTags) {
    setMeta(`meta[property="${property}"]`, () => {
      const el = document.createElement('meta');
      el.setAttribute('property', property);
      return el;
    }, content);
  }

  const twitterTags: [string, string][] = [
    ['twitter:card', 'summary_large_image'],
    ['twitter:title', meta.title],
    ['twitter:description', meta.description],
    ['twitter:image', image],
  ];
  for (const [name, content] of twitterTags) {
    setMeta(`meta[name="${name}"]`, () => {
      const el = document.createElement('meta');
      el.setAttribute('name', name);
      return el;
    }, content);
  }
}

export function siteJsonLdGraph() {
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'Organization',
        '@id': `${SITE_URL}/#organization`,
        name: SITE_NAME,
        url: SITE_URL,
        logo: `${SITE_URL}/favicon.svg`,
      },
      {
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        name: SITE_NAME,
        url: SITE_URL,
        description:
          'Free PC Builder and FPS Estimator. Pick GPU, CPU, and other components, check compatibility, and get estimated FPS across popular games and resolutions.',
        publisher: { '@id': `${SITE_URL}/#organization` },
        potentialAction: {
          '@type': 'SearchAction',
          target: `${SITE_URL}/builder?{search_term_string}`,
          'query-input': 'required name=search_term_string',
        },
      },
    ],
  };
}
