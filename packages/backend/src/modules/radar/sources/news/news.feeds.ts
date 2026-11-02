import type { FeedDefinition } from './feed-module.factory'

// RSS/Atom sources. Each entry becomes an independent module (own cache, timeout, status).
// Verified 2026-11-02 from the production server: HTTP 200, valid RSS/Atom, final URL (no redirects).
// Polish-language sources only (decision 2026-11-02: English sources were removed).
// TVN24 was removed earlier: it answers 403 to the server's (data-centre) IP. See docs/RADAR.md.

const RMF = { name: 'RMF24', homepage: 'https://www.rmf24.pl' }

export const NEWS_FEEDS: FeedDefinition[] = [
  // ---- Polska ----
  { id: 'news.rmf.poland', name: 'RMF24 – Polska', category: 'poland', url: 'https://www.rmf24.pl/fakty/polska/feed', source: RMF, description: 'Najnowsze wiadomości z Polski' },

  // ---- Świat ----
  { id: 'news.rmf.world', name: 'RMF24 – Świat', category: 'world', url: 'https://www.rmf24.pl/fakty/swiat/feed', source: RMF, description: 'Wiadomości ze świata' },

  // ---- Warszawa ----
  { id: 'news.rmf.warsaw', name: 'RMF24 – Warszawa', category: 'warsaw', url: 'https://www.rmf24.pl/regiony/warszawa/feed', source: RMF, description: 'Wiadomości z Warszawy' },

  // ---- Gospodarka ----
  { id: 'news.rmf.economy', name: 'RMF24 – Ekonomia', category: 'economy', url: 'https://www.rmf24.pl/ekonomia/feed', source: RMF, description: 'Wiadomości gospodarcze' },
  { id: 'news.bankier', name: 'Bankier.pl', category: 'economy', url: 'https://www.bankier.pl/rss/wiadomosci.xml', source: { name: 'Bankier.pl', homepage: 'https://www.bankier.pl' }, description: 'Wiadomości gospodarcze i finansowe' },

  // ---- Bezpieczeństwo IT ----
  { id: 'news.cert.pl', name: 'CERT Polska', category: 'security', url: 'https://cert.pl/rss.xml', source: { name: 'CERT Polska', homepage: 'https://cert.pl' }, description: 'Ostrzeżenia i analizy CERT Polska', cacheTtlMinutes: 60 },
  { id: 'news.sekurak', name: 'Sekurak', category: 'security', url: 'https://sekurak.pl/feed/', source: { name: 'Sekurak', homepage: 'https://sekurak.pl' }, description: 'Bezpieczeństwo IT', cacheTtlMinutes: 60 },
  { id: 'news.niebezpiecznik', name: 'Niebezpiecznik', category: 'security', url: 'https://feeds.feedburner.com/niebezpiecznik/', source: { name: 'Niebezpiecznik', homepage: 'https://niebezpiecznik.pl' }, description: 'Bezpieczeństwo IT i prywatność', cacheTtlMinutes: 60 },
]
