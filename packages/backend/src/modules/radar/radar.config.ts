import type { RelevanceRules } from './parsing/relevance'

// User preferences for Personal Radar. A plain file in the repo on purpose:
// it is configuration, not fetched data, and changing it does not need a DB migration.

export const radarConfig = {
  location: {
    name: 'Warszawa',
    latitude: 52.2297,
    longitude: 21.0122,
    timeZone: 'Europe/Warsaw',
    /** TERYT code of the powiat — IMGW meteo warnings are issued per powiat (1465 = m.st. Warszawa). */
    terytPowiat: '1465',
    voivodeship: 'mazowieckie',
    /** City name as used by GIOŚ station list. */
    giosCity: 'Warszawa',
  },

  weather: {
    /** Hours of hourly forecast attached to weather.now. */
    hours: 12,
    /** Days in weather.forecast. */
    days: 7,
  },

  alerts: {
    /** IMGW hydro warnings are per catchment; keep only those mentioning these rivers (prefix match). */
    hydroAreaKeywords: ['wisł*'],
    /** GIOŚ: stations whose hourly PM10/PM2.5/NO2 values are fetched (others: index only — fewer requests). */
    giosValueStationIds: [530, 552],
    /** ZTM/WTP news that look like disruptions or route changes. */
    transportKeywords: [
      'utrudnie*', 'objazd*', 'zmian* w kursowaniu', 'zmian* tras*', 'remont*', 'przebudow*', 'zamknię*',
      'wyłącz*', 'komunikacj* zastępcz*', 'jak dojechać', 'nie pojad*', 'awari*', 'kursowani*',
    ],
    transportMaxAgeDays: 14,
  },

  reader: {
    /** Article Reader works only for these domains (and their subdomains): the sites our news feeds link to. */
    allowedDomains: ['rmf24.pl', 'bankier.pl', 'cert.pl', 'sekurak.pl', 'niebezpiecznik.pl', 'ztm.waw.pl', 'wtp.waw.pl'],
  },

  finance: {
    /** Currencies from NBP table A, in display order. */
    currencies: ['EUR', 'USD'],
  },

  news: {
    /** Max items a single news module returns (newest first). */
    maxItemsPerFeed: 30,
    relevance: {
      // "word" = whole word, "prefix*" = any word starting with prefix (Polish inflection).
      interests: [
        { label: 'Vue/Vite', keywords: ['vue', 'vue.js', 'vuejs', 'pinia', 'nuxt', 'vite'], weight: 3 },
        { label: 'JavaScript', keywords: ['javascript', 'typescript', 'ecmascript', 'npm', 'deno', 'bun'], weight: 3 },
        { label: 'Node.js', keywords: ['node.js', 'nodejs', 'node', 'express'], weight: 3 },
        { label: 'PostgreSQL', keywords: ['postgresql', 'postgres', 'pg_*'], weight: 2 },
        { label: 'Docker', keywords: ['docker', 'kubernetes', 'k8s', 'kontener*', 'container*'], weight: 2 },
        { label: 'AI', keywords: ['ai', 'llm*', 'sztuczn* inteligencj*', 'openai', 'anthropic', 'claude', 'gpt*', 'gemini'], weight: 2 },
        { label: 'Programowanie', keywords: ['programowani*', 'programist*', 'developer*', 'open source', 'open-source'], weight: 1 },
        { label: 'Bezpieczeństwo', keywords: ['cve-*', 'podatnoś*', 'vulnerabilit*', 'ransomware', 'phishing*', 'wyciek*'], weight: 1 },
        { label: 'Warszawa', keywords: ['warszaw*', 'stołeczn*', 'ztm', 'metro', 'metra', 'metrze'], weight: 2 },
        { label: 'Polska', keywords: ['polsk*', 'sejm*', 'rząd*', 'prezydent*'], weight: 1 },
        { label: 'Gospodarka', keywords: ['gospodar*', 'inflacj*', 'stop* procentow*', 'nbp', 'pkb', 'podatek', 'podatk*'], weight: 1 },
      ],
      excludeKeywords: [],
      // Fresher news rank higher: ≤3 h → +2, ≤12 h → +1.
      freshnessBonus: [
        [3, 2],
        [12, 1],
      ],
      // Older than 7 days → score 0 (blogs keep years-old posts in their feeds).
      staleAfterHours: 7 * 24,
    } satisfies RelevanceRules,
  },
} as const
