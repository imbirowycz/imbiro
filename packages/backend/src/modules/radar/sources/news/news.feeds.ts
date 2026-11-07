import type { FeedDefinition } from './feed-module.factory'

// RSS/Atom sources. Each entry becomes an independent module (own cache, timeout, status).
// Verified 2026-11-02 from the production server: HTTP 200, valid RSS/Atom, final URL (no redirects).
// Polish-language sources (decision 2026-11-02: English sources were removed), plus two
// Ukrainian IT sources (DOU, dev.ua) added on purpose the same day.
// TVN24 was removed earlier: it answers 403 to the server's (data-centre) IP. See docs/RADAR.md.
// DOU: only /feed/ ("Найцікавіше", ~5 entries) passes from the server — its category feeds
// (/lenta/news/feed/, /lenta/articles/feed/, /forums/feed/) get a Cloudflare 403 there.

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

  // ---- IT (Polscy Programiści has no feed: see polscy-programisci.module.ts) ----
  { id: 'news.justjoinit', name: 'Just Join IT – blog', category: 'it', url: 'https://justjoin.it/blog/feed', source: { name: 'Just Join IT', homepage: 'https://justjoin.it/blog' }, description: 'Programowanie i rynek pracy IT', cacheTtlMinutes: 60 },
  { id: 'news.geekweek', name: 'GeekWeek', category: 'it', url: 'https://geekweek.interia.pl/feed', source: { name: 'GeekWeek Interia', homepage: 'https://geekweek.interia.pl' }, description: 'Nauka i nowe technologie', cacheTtlMinutes: 30 },
  { id: 'news.dou', name: 'DOU', category: 'it', url: 'https://dou.ua/feed/', source: { name: 'DOU', homepage: 'https://dou.ua' }, description: 'Najciekawsze z DOU – ukraińska społeczność IT', cacheTtlMinutes: 30 },
  { id: 'news.devua', name: 'dev.ua', category: 'it', url: 'https://dev.ua/rss', source: { name: 'dev.ua', homepage: 'https://dev.ua' }, description: 'Ukraińskie media o technologiach i IT', cacheTtlMinutes: 30 },

  // ---- Bezpieczeństwo IT ----
  { id: 'news.cert.pl', name: 'CERT Polska', category: 'security', url: 'https://cert.pl/rss.xml', source: { name: 'CERT Polska', homepage: 'https://cert.pl' }, description: 'Ostrzeżenia i analizy CERT Polska', cacheTtlMinutes: 60 },
  { id: 'news.sekurak', name: 'Sekurak', category: 'security', url: 'https://sekurak.pl/feed/', source: { name: 'Sekurak', homepage: 'https://sekurak.pl' }, description: 'Bezpieczeństwo IT', cacheTtlMinutes: 60 },
  { id: 'news.niebezpiecznik', name: 'Niebezpiecznik', category: 'security', url: 'https://feeds.feedburner.com/niebezpiecznik/', source: { name: 'Niebezpiecznik', homepage: 'https://niebezpiecznik.pl' }, description: 'Bezpieczeństwo IT i prywatność', cacheTtlMinutes: 60 },
  // ---- Zdrowie (odżywianie, trening) — added 2026-11-03 ----
  { id: 'news.dietetycy', name: 'Dietetycy.org.pl', category: 'health', url: 'https://dietetycy.org.pl/feed/', source: { name: 'Dietetycy.org.pl', homepage: 'https://dietetycy.org.pl' }, description: 'Dietetyka oparta na badaniach', cacheTtlMinutes: 120 },
  { id: 'news.interia.health', name: 'Interia Zdrowie', category: 'health', url: 'https://zdrowie.interia.pl/feed', source: { name: 'Interia Zdrowie', homepage: 'https://zdrowie.interia.pl' }, description: 'Zdrowie, dieta i aktywność', cacheTtlMinutes: 60 },
  { id: 'news.mensfitness', name: "Men's Fitness", category: 'health', url: 'https://mensfitness.pl/feed/', source: { name: "Men's Fitness", homepage: 'https://mensfitness.pl' }, description: 'Trening, odżywianie i suplementacja', cacheTtlMinutes: 120 },
  { id: 'news.bieganie', name: 'Bieganie.pl', category: 'health', url: 'https://bieganie.pl/feed/', source: { name: 'Bieganie.pl', homepage: 'https://bieganie.pl' }, description: 'Trening biegowy i starty', cacheTtlMinutes: 60 },

  { id: 'news.zaufana', name: 'Zaufana Trzecia Strona', category: 'security', url: 'https://zaufanatrzeciastrona.pl/feed.xml', source: { name: 'Zaufana Trzecia Strona', homepage: 'https://zaufanatrzeciastrona.pl' }, description: 'Bezpieczeństwo IT i prywatność', cacheTtlMinutes: 60 },
]
