// Deliberately no imports from prebuilts.ts / matchups.ts / gamePages.ts /
// cpuGamePages.ts here — those modules pull in the full GPU/CPU/game JSON
// datasets, and this file is a shared chunk loaded by every lazy route via
// useSeo(). Their meta-generator functions (getPrebuiltMeta, getMatchupMeta,
// etc.) live in their owning modules instead so a page that only needs
// getRouteMeta (Home, About, ...) doesn't pay to download unrelated data.

export const SITE_URL = 'https://specsmithpc.com';
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
    title: 'Gaming PC Build Guides — 5 Curated Part Lists | SpecSmith',
    description:
      'Five curated PC build guides across budget, 1080p, 1440p, and 4K tiers — full part lists with estimated FPS and total cost. Load any build straight into the Builder to customize it.',
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
    path: '/best-gpu',
    title: 'Best GPU by Game — FPS-Tested Picks for 20 Games | SpecSmith',
    description:
      'Find the best graphics card for the game you actually play: FPS-ranked picks for Fortnite, Valorant, Cyberpunk 2077, and 17 more titles — best value, budget, 144 FPS, and 4K picks with estimated FPS at every resolution.',
  },
  {
    path: '/best-cpu',
    title: 'Best CPU by Game — Gaming FPS Compared for 20 Games | SpecSmith',
    description:
      'Find the best processor for the game you actually play: FPS-ranked CPU picks for Fortnite, Valorant, Cyberpunk 2077, and 17 more titles, paired with an RTX 4090 to isolate CPU performance.',
  },
  {
    path: '/gpu-tier-list',
    title: 'GPU Tier List (2026) — Every Graphics Card Ranked S to D | SpecSmith',
    description:
      'Every GPU we track ranked S through D by performance-per-dollar and raw FPS — RTX 40/50 series, AMD RX 6000/7000/9000, and Intel Arc. Updated with current market pricing.',
  },
  {
    path: '/vs',
    title: 'GPU & CPU Comparisons — Head-to-Head FPS in 20 Games | SpecSmith',
    description:
      'Compare popular GPUs and CPUs head-to-head: estimated FPS in 20 games at 1080p, 1440p, and 4K, plus specs and price-per-frame value. RTX 40/50 series vs AMD Radeon vs Intel Arc, Ryzen vs Intel Core.',
  },
  {
    path: '/upgrade-calculator',
    title: 'GPU Trade-Up Calculator — Is It Worth Upgrading? | SpecSmith',
    description:
      'See what your current GPU is roughly worth used, what it actually costs to trade up to a faster card after resale, and the real FPS gain — before you spend anything.',
  },
  {
    path: '/crate',
    title: 'Build Crate — Random PC Build Generator | SpecSmith',
    description:
      'Open a Build Crate for a fully random gaming PC — every part guaranteed to physically fit together, with a rarity pull based on how high-end you land. See the total cost and estimated FPS instantly.',
  },
  {
    path: '/upgrade',
    title: 'GPU Upgrade Guides — What Should You Upgrade To? | SpecSmith',
    description:
      'Browse upgrade guides for every GPU we track — estimated resale value, real upgrade options ranked by FPS gain, and net cost after trading up.',
  },
  {
    path: '/upgrade-cpu',
    title: 'CPU Upgrade Guides — What Should You Upgrade To? | SpecSmith',
    description:
      'Browse upgrade guides for every CPU we track — estimated resale value, real upgrade options ranked by FPS gain, and net cost after trading up.',
  },
  {
    path: '/gallery',
    title: 'Build Gallery — Real PC Builds from SpecSmith Users',
    description:
      'Browse real gaming PC builds published by SpecSmith users, with full part lists, total cost, estimated FPS, and buy links. Load any build straight into the Builder.',
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
        logo: `${SITE_URL}/favicon-512.png`,
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
