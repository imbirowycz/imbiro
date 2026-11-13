-- Okazje: pages are fetched by the home collector, not by the server.

-- A single source can be switched off without deleting its history.
ALTER TABLE price_sources ADD COLUMN enabled BOOLEAN NOT NULL DEFAULT TRUE;

-- One row: when the collector last asked for work (shown in the PWA as online/offline).
CREATE TABLE price_collector_state (
  id           BOOLEAN PRIMARY KEY DEFAULT TRUE,
  last_seen_at TIMESTAMPTZ NOT NULL,
  hostname     TEXT,
  CONSTRAINT price_collector_state_single_chk CHECK (id)
);
