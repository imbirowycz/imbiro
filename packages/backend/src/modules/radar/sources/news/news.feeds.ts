import type { FeedDefinition } from './feed-module.factory'

// RSS/Atom sources. Each entry becomes an independent module (own cache, timeout, status).
// Verified 2026-11-02: HTTP 200, valid RSS/Atom, final URL (no redirects). See docs/RADAR.md.

const RMF = { name: 'RMF24', homepage: 'https://www.rmf24.pl' }
const TVN24 = { name: 'TVN24', homepage: 'https://tvn24.pl' }
const BBC = { name: 'BBC News', homepage: 'https://www.bbc.com/news' }

const githubReleases = (repo: string, prefix: string): FeedDefinition => ({
  id: `news.github.releases.${prefix.toLowerCase()}`,
  name: `${prefix} – wydania`,
  category: 'it',
  url: `https://github.com/${repo}/releases.atom`,
  source: { name: 'GitHub Releases', homepage: `https://github.com/${repo}/releases` },
  description: `Nowe wersje ${repo}`,
  titlePrefix: prefix,
  cacheTtlMinutes: 60,
})

export const NEWS_FEEDS: FeedDefinition[] = [
  // ---- Polska ----
  { id: 'news.rmf.poland', name: 'RMF24 – Polska', category: 'poland', url: 'https://www.rmf24.pl/fakty/polska/feed', source: RMF, description: 'Najnowsze wiadomości z Polski' },
  { id: 'news.tvn24.latest', name: 'TVN24 – najnowsze', category: 'poland', url: 'https://tvn24.pl/najnowsze.xml', source: TVN24, description: 'Najnowsze wiadomości TVN24' },

  // ---- Świat ----
  { id: 'news.rmf.world', name: 'RMF24 – Świat', category: 'world', url: 'https://www.rmf24.pl/fakty/swiat/feed', source: RMF, description: 'Wiadomości ze świata' },
  { id: 'news.bbc.world', name: 'BBC – World', category: 'world', url: 'https://feeds.bbci.co.uk/news/world/rss.xml', source: BBC, description: 'BBC World News (EN)' },
  { id: 'news.guardian.world', name: 'The Guardian – World', category: 'world', url: 'https://www.theguardian.com/world/rss', source: { name: 'The Guardian', homepage: 'https://www.theguardian.com' }, description: 'The Guardian World (EN)' },

  // ---- Warszawa ----
  { id: 'news.rmf.warsaw', name: 'RMF24 – Warszawa', category: 'warsaw', url: 'https://www.rmf24.pl/regiony/warszawa/feed', source: RMF, description: 'Wiadomości z Warszawy' },
  { id: 'news.tvn24.warsaw', name: 'TVN Warszawa', category: 'warsaw', url: 'https://tvn24.pl/tvnwarszawa/najnowsze.xml', source: TVN24, description: 'Najnowsze wiadomości TVN Warszawa' },

  // ---- Gospodarka ----
  { id: 'news.rmf.economy', name: 'RMF24 – Ekonomia', category: 'economy', url: 'https://www.rmf24.pl/ekonomia/feed', source: RMF, description: 'Wiadomości gospodarcze' },
  { id: 'news.bankier', name: 'Bankier.pl', category: 'economy', url: 'https://www.bankier.pl/rss/wiadomosci.xml', source: { name: 'Bankier.pl', homepage: 'https://www.bankier.pl' }, description: 'Wiadomości gospodarcze i finansowe' },
  { id: 'news.bbc.business', name: 'BBC – Business', category: 'economy', url: 'https://feeds.bbci.co.uk/news/business/rss.xml', source: BBC, description: 'BBC Business (EN)' },

  // ---- IT ----
  { id: 'news.bbc.technology', name: 'BBC – Technology', category: 'it', url: 'https://feeds.bbci.co.uk/news/technology/rss.xml', source: BBC, description: 'BBC Technology (EN)' },
  // Feed contains the whole blog history (~1000 entries, ~330 KB) — we keep only the newest.
  { id: 'news.nodejs', name: 'Node.js – blog', category: 'it', url: 'https://nodejs.org/en/feed/blog.xml', source: { name: 'Node.js', homepage: 'https://nodejs.org' }, description: 'Oficjalny blog Node.js (wydania, security releases)', cacheTtlMinutes: 60, maxBytes: 3 * 1024 * 1024 },
  { id: 'news.vue.blog', name: 'Vue.js – blog', category: 'it', url: 'https://blog.vuejs.org/feed.rss', source: { name: 'Vue.js', homepage: 'https://blog.vuejs.org' }, description: 'Oficjalny blog Vue.js', cacheTtlMinutes: 60 },
  { id: 'news.typescript.blog', name: 'TypeScript – blog', category: 'it', url: 'https://devblogs.microsoft.com/typescript/feed/', source: { name: 'TypeScript', homepage: 'https://devblogs.microsoft.com/typescript' }, description: 'Oficjalny blog TypeScript', cacheTtlMinutes: 60 },
  githubReleases('vuejs/core', 'Vue'),
  githubReleases('vuejs/pinia', 'Pinia'),
  githubReleases('vitejs/vite', 'Vite'),
  githubReleases('expressjs/express', 'Express'),
  { id: 'news.javascriptweekly', name: 'JavaScript Weekly', category: 'it', url: 'https://javascriptweekly.com/rss/', source: { name: 'JavaScript Weekly', homepage: 'https://javascriptweekly.com' }, description: 'Cotygodniowy przegląd JavaScript', cacheTtlMinutes: 180 },
  { id: 'news.postgresql', name: 'PostgreSQL – news', category: 'it', url: 'https://www.postgresql.org/news.rss', source: { name: 'PostgreSQL', homepage: 'https://www.postgresql.org' }, description: 'Wydania i ogłoszenia PostgreSQL', cacheTtlMinutes: 120 },
  { id: 'news.docker.blog', name: 'Docker – blog', category: 'it', url: 'https://www.docker.com/feed/', source: { name: 'Docker', homepage: 'https://www.docker.com/blog' }, description: 'Oficjalny blog Docker', cacheTtlMinutes: 120 },

  // ---- AI ----
  { id: 'news.simonwillison', name: 'Simon Willison', category: 'ai', url: 'https://simonwillison.net/atom/everything/', source: { name: 'Simon Willison', homepage: 'https://simonwillison.net' }, description: 'Praktyczne notatki o LLM i narzędziach AI (EN)', cacheTtlMinutes: 60 },

  // ---- Bezpieczeństwo ----
  { id: 'news.cert.pl', name: 'CERT Polska', category: 'security', url: 'https://cert.pl/rss.xml', source: { name: 'CERT Polska', homepage: 'https://cert.pl' }, description: 'Ostrzeżenia i analizy CERT Polska', cacheTtlMinutes: 60 },
  { id: 'news.sekurak', name: 'Sekurak', category: 'security', url: 'https://sekurak.pl/feed/', source: { name: 'Sekurak', homepage: 'https://sekurak.pl' }, description: 'Bezpieczeństwo IT', cacheTtlMinutes: 60 },
  { id: 'news.niebezpiecznik', name: 'Niebezpiecznik', category: 'security', url: 'https://feeds.feedburner.com/niebezpiecznik/', source: { name: 'Niebezpiecznik', homepage: 'https://niebezpiecznik.pl' }, description: 'Bezpieczeństwo IT i prywatność', cacheTtlMinutes: 60 },
  { id: 'news.thehackernews', name: 'The Hacker News', category: 'security', url: 'https://feeds.feedburner.com/TheHackersNews', source: { name: 'The Hacker News', homepage: 'https://thehackernews.com' }, description: 'Cyberbezpieczeństwo (EN)', cacheTtlMinutes: 60 },
]
