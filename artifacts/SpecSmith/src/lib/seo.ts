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
      'Build a compatible gaming PC and see estimated FPS across 20 games before you buy — 50+ GPUs and CPUs, live compatibility checks, and real pricing.',
  },
  {
    path: '/404',
    title: 'Page Not Found | SpecSmith',
    description: 'The page you\'re looking for doesn\'t exist or may have moved.',
    noindex: true,
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
      'Five curated PC build guides for budget, 1080p, 1440p, and 4K — full part lists with estimated FPS and cost, ready to load into the Builder.',
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
      'Find the best graphics card for the game you actually play — FPS-ranked picks for Fortnite, Valorant, Cyberpunk 2077, and 17 more titles.',
  },
  {
    path: '/best-cpu',
    title: 'Best CPU by Game — FPS Compared | SpecSmith',
    description:
      'Find the best processor for the game you actually play — FPS-ranked CPU picks for Fortnite, Valorant, Cyberpunk 2077, and 17 more titles.',
  },
  {
    path: '/gpu-tier-list',
    title: 'GPU Tier List — Ranked S to D | SpecSmith',
    description:
      'Every GPU we track ranked S through D by performance-per-dollar and raw FPS — RTX 40/50, AMD RX 6000/7000/9000, and Intel Arc.',
    image: `${SITE_URL}/opengraph-gpu-tier-list.jpg`,
  },
  {
    path: '/cpu-tier-list',
    title: 'CPU Tier List — Ranked S to D | SpecSmith',
    description:
      'Every CPU we track ranked S through D by raw gaming performance — Ryzen 9000/7000, Intel Core Ultra, and 12th-14th gen.',
    image: `${SITE_URL}/opengraph-cpu-tier-list.jpg`,
  },
  {
    path: '/vs',
    title: 'GPU & CPU Comparisons | SpecSmith',
    description:
      'Compare popular GPUs and CPUs head-to-head — estimated FPS in 20 games at 1080p, 1440p, and 4K, plus specs and price-per-frame value.',
  },
  {
    path: '/upgrade-calculator',
    title: 'GPU Trade-Up Calculator — Is It Worth Upgrading? | SpecSmith',
    description:
      'See what your current GPU is worth used, what it costs to trade up to a faster card after resale, and the real FPS gain.',
  },
  {
    path: '/upgrade-calculator-cpu',
    title: 'CPU Trade-Up Calculator — Is It Worth Upgrading? | SpecSmith',
    description:
      'See what your current CPU is worth used, what it costs to trade up to a faster chip after resale, and the real FPS gain.',
  },
  {
    path: '/crate',
    title: 'Build Crate — Random PC Build Generator | SpecSmith',
    description:
      'Open a Build Crate for a fully random gaming PC — every part guaranteed to fit together, with a rarity pull based on how high-end you land.',
    image: `${SITE_URL}/opengraph-crate.jpg`,
  },
  {
    path: '/price-guesser',
    title: 'Higher or Lower — PC Part Price Guessing Game | SpecSmith',
    description:
      'Guess whether the next GPU or CPU costs more or less than the last — using real street prices from the SpecSmith Builder. How high can you streak?',
    image: `${SITE_URL}/opengraph-price-guesser.jpg`,
  },
  {
    path: '/quiz',
    title: 'What PC Should I Get? — PC Build Quiz | SpecSmith',
    description:
      'Answer 2 quick questions about your use case and budget to get a matched GPU + CPU pick with real prices — then load it straight into the Builder.',
  },
  {
    path: '/upgrade',
    title: 'GPU Upgrade Guides — What Should You Upgrade To? | SpecSmith',
    description:
      'Browse upgrade guides for every GPU we track — estimated resale value, real upgrade options ranked by FPS gain, and net cost after trading up.',
  },
  {
    path: '/parts-guides',
    title: 'PC Parts Buying Guides — GPU, CPU, RAM, and More | SpecSmith',
    description:
      'Every buying guide on SpecSmith in one place — tier lists, upgrade guides, and budget-to-premium picks for every PC part and peripheral.',
  },
  {
    path: '/best-motherboard',
    title: 'Best Motherboards by Platform | SpecSmith',
    description:
      'Every motherboard we track, organized by CPU socket — budget, sweet-spot, and high-end picks for AMD AM4/AM5 and Intel LGA1700/LGA1851 builds.',
  },
  {
    path: '/upgrade-cpu',
    title: 'CPU Upgrade Guides — What Should You Upgrade To? | SpecSmith',
    description:
      'Browse upgrade guides for every CPU we track — estimated resale value, real upgrade options ranked by FPS gain, and net cost after trading up.',
  },
  {
    path: '/best-gpu-budget',
    title: 'Best GPU by Budget | SpecSmith',
    description:
      'Pick a price ceiling to see the strongest GPUs we track that fit under it, ranked by benchmark performance — from under $200 to under $1,500.',
  },
  {
    path: '/best-cpu-budget',
    title: 'Best CPU by Budget | SpecSmith',
    description:
      'Pick a price ceiling to see the strongest CPUs we track that fit under it, ranked by benchmark performance — from under $150 to under $1,000.',
  },
  {
    path: '/best-pc-for',
    title: 'Best PC Build by Use Case | SpecSmith',
    description:
      'GPU and CPU picks weighted for what actually matters outside pure gaming FPS — streaming, video editing, and more, across three budgets each.',
  },
  {
    path: '/gallery',
    title: 'Build Gallery — Real PC Builds from SpecSmith Users',
    description:
      'Browse real gaming PC builds published by SpecSmith users — full part lists, total cost, estimated FPS, and buy links.',
    image: `${SITE_URL}/opengraph-gallery.jpg`,
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

  let breadcrumbScript = document.getElementById('breadcrumb-jsonld');
  const breadcrumb = breadcrumbJsonLd(meta);
  if (breadcrumb) {
    if (!breadcrumbScript) {
      breadcrumbScript = document.createElement('script');
      breadcrumbScript.id = 'breadcrumb-jsonld';
      breadcrumbScript.setAttribute('type', 'application/ld+json');
      document.head.appendChild(breadcrumbScript);
    }
    breadcrumbScript.textContent = JSON.stringify(breadcrumb);
  } else if (breadcrumbScript) {
    breadcrumbScript.remove();
  }
}

export interface BreadcrumbItem {
  name: string;
  path: string;
}

// :slug detail pages get their listing page as the middle breadcrumb.
const SECTION_PARENTS: { prefix: string; parent: BreadcrumbItem }[] = [
  { prefix: '/vs/', parent: { name: 'GPU & CPU Comparisons', path: '/vs' } },
  { prefix: '/best-gpu/', parent: { name: 'Best GPU by Game', path: '/best-gpu' } },
  { prefix: '/best-cpu/', parent: { name: 'Best CPU by Game', path: '/best-cpu' } },
  { prefix: '/upgrade/', parent: { name: 'GPU Upgrade Guides', path: '/upgrade' } },
  { prefix: '/upgrade-cpu/', parent: { name: 'CPU Upgrade Guides', path: '/upgrade-cpu' } },
  { prefix: '/best-motherboard/', parent: { name: 'Best Motherboards by Platform', path: '/best-motherboard' } },
  { prefix: '/best-gpu-budget/', parent: { name: 'Best GPU by Budget', path: '/best-gpu-budget' } },
  { prefix: '/best-cpu-budget/', parent: { name: 'Best CPU by Budget', path: '/best-cpu-budget' } },
  { prefix: '/best-pc-for/', parent: { name: 'Best PC Build by Use Case', path: '/best-pc-for' } },
  { prefix: '/prebuilts/', parent: { name: 'Gaming PC Build Guides', path: '/prebuilts' } },
  { prefix: '/quiz/', parent: { name: 'PC Build Quiz', path: '/quiz' } },
];

// Standalone guide/index pages that hang off the Parts Guides hub.
const PARTS_GUIDES_PAGES = new Set([
  '/gpu-tier-list', '/cpu-tier-list', '/upgrade', '/upgrade-cpu', '/best-motherboard',
  '/best-ram', '/best-storage', '/best-psu', '/best-case', '/best-cooler',
  '/best-monitor', '/best-keyboard', '/best-mouse', '/best-headset',
  '/best-gpu-budget', '/best-cpu-budget', '/best-pc-for',
]);

function cleanTitle(title: string): string {
  return title.replace(/\s*[|—]\s*SpecSmith.*$/, '').trim();
}

export function getBreadcrumbItems(meta: RouteMeta): BreadcrumbItem[] | null {
  if (meta.path === '/' || meta.noindex) return null;
  const items: BreadcrumbItem[] = [{ name: 'Home', path: '/' }];

  const section = SECTION_PARENTS.find((s) => meta.path.startsWith(s.prefix));
  if (section) {
    items.push(section.parent);
  } else if (PARTS_GUIDES_PAGES.has(meta.path)) {
    items.push({ name: 'Parts Guides', path: '/parts-guides' });
  }

  items.push({ name: cleanTitle(meta.title), path: meta.path });
  return items;
}

export function breadcrumbJsonLd(meta: RouteMeta): Record<string, unknown> | null {
  const items = getBreadcrumbItems(meta);
  if (!items || items.length < 2) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: item.name,
      item: `${SITE_URL}${item.path === '/' ? '/' : item.path}`,
    })),
  };
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
      },
    ],
  };
}
