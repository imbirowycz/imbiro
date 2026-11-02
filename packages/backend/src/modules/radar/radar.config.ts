// User preferences for Personal Radar. A plain file in the repo on purpose:
// it is configuration, not fetched data, and changing it does not need a DB migration.
// Later stages add news interests and location here.

export const radarConfig = {
  finance: {
    /** Currencies from NBP table A, in display order. */
    currencies: ['EUR', 'USD', 'CHF', 'GBP'],
  },
} as const
