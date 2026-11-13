-- Łowca cen: artykuły, źródła, historia cen, okazje, zrzuty HTML do diagnozy.
-- Usunięcie artykułu kasuje kaskadowo wszystko poniżej; zadanie schedulera usuwa serwis
-- w tej samej transakcji (FK RESTRICT pilnuje, żeby nie zniknęło samo).

CREATE TABLE price_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  description       TEXT,
  ean               TEXT,
  target_price      NUMERIC(12, 2),
  min_drop_pct      NUMERIC(5, 2) NOT NULL DEFAULT 5,
  enabled           BOOLEAN NOT NULL DEFAULT TRUE,
  notify_telegram   BOOLEAN NOT NULL DEFAULT FALSE,
  telegram_chat_id  TEXT,
  notify_email      BOOLEAN NOT NULL DEFAULT FALSE,
  email_to          TEXT,
  jitter_minutes    INTEGER NOT NULL DEFAULT 60,
  scheduled_task_id UUID NOT NULL UNIQUE REFERENCES scheduled_tasks (id) ON DELETE RESTRICT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT price_items_name_chk CHECK (char_length(btrim(name)) BETWEEN 1 AND 200),
  CONSTRAINT price_items_target_chk CHECK (target_price IS NULL OR target_price > 0),
  CONSTRAINT price_items_drop_chk CHECK (min_drop_pct BETWEEN 0 AND 90),
  CONSTRAINT price_items_jitter_chk CHECK (jitter_minutes BETWEEN 0 AND 240),
  CONSTRAINT price_items_telegram_chk CHECK (NOT notify_telegram OR telegram_chat_id IS NOT NULL),
  CONSTRAINT price_items_email_chk CHECK (NOT notify_email OR email_to IS NOT NULL)
);

CREATE INDEX price_items_created_idx ON price_items (created_at DESC);

CREATE TRIGGER price_items_set_updated_at
  BEFORE UPDATE ON price_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE price_sources (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id              UUID NOT NULL REFERENCES price_items (id) ON DELETE CASCADE,
  label                TEXT NOT NULL,
  url                  TEXT NOT NULL,
  fetch_mode           TEXT NOT NULL DEFAULT 'auto',
  preferred_fetcher    TEXT NOT NULL DEFAULT 'http',
  parser_config        JSONB NOT NULL,
  status               TEXT NOT NULL DEFAULT 'untested',
  last_error           TEXT,
  last_error_code      TEXT,
  last_checked_at      TIMESTAMPTZ,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  failing_alerted      BOOLEAN NOT NULL DEFAULT FALSE,
  -- Ostatni udany pomiar (do listy i do wykrywania zmian).
  last_price           NUMERIC(12, 2),
  last_old_price       NUMERIC(12, 2),
  last_available       BOOLEAN,
  last_title           TEXT,
  last_currency        TEXT,
  last_success_at      TIMESTAMPTZ,
  position             INTEGER NOT NULL DEFAULT 0,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT price_sources_fetch_mode_chk CHECK (fetch_mode IN ('auto', 'http', 'browser')),
  CONSTRAINT price_sources_preferred_chk CHECK (preferred_fetcher IN ('http', 'browser')),
  CONSTRAINT price_sources_status_chk CHECK (status IN ('untested', 'ok', 'warning', 'failing', 'blocked')),
  CONSTRAINT price_sources_config_chk CHECK (jsonb_typeof(parser_config) = 'object')
);

CREATE INDEX price_sources_item_idx ON price_sources (item_id, position);

CREATE TRIGGER price_sources_set_updated_at
  BEFORE UPDATE ON price_sources
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE price_observations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id   UUID NOT NULL REFERENCES price_sources (id) ON DELETE CASCADE,
  checked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ok          BOOLEAN NOT NULL,
  price       NUMERIC(12, 2),
  old_price   NUMERIC(12, 2),
  currency    TEXT,
  available   BOOLEAN,
  title       TEXT,
  fetcher     TEXT,
  duration_ms INTEGER,
  error_code  TEXT,
  error       TEXT
);

CREATE INDEX price_observations_source_idx ON price_observations (source_id, checked_at DESC);

CREATE TABLE price_offers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id        UUID NOT NULL REFERENCES price_items (id) ON DELETE CASCADE,
  source_id      UUID NOT NULL REFERENCES price_sources (id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,
  title          TEXT NOT NULL,
  url            TEXT NOT NULL,
  price          NUMERIC(12, 2) NOT NULL,
  previous_price NUMERIC(12, 2),
  drop_amount    NUMERIC(12, 2),
  drop_pct       NUMERIC(6, 2),
  currency       TEXT NOT NULL DEFAULT 'PLN',
  detected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- Usunięta przez użytkownika: znika z listy, wraca tylko przy niższej cenie.
  dismissed_at   TIMESTAMPTZ,
  read_at        TIMESTAMPTZ,
  notified_at    TIMESTAMPTZ,
  notify_error   TEXT,

  CONSTRAINT price_offers_kind_chk CHECK (kind IN ('price_drop', 'promo', 'target_reached', 'back_in_stock', 'lowest_30d'))
);

-- Najwyżej jedna widoczna okazja danego rodzaju na źródło.
CREATE UNIQUE INDEX price_offers_visible_uq ON price_offers (source_id, kind) WHERE dismissed_at IS NULL;
CREATE INDEX price_offers_detected_idx ON price_offers (detected_at DESC);
CREATE INDEX price_offers_item_idx ON price_offers (item_id, read_at);

CREATE TABLE price_debug_snapshots (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  source_id  UUID NOT NULL REFERENCES price_sources (id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  fetcher    TEXT,
  http_status INTEGER,
  error_code TEXT,
  html       TEXT NOT NULL
);

CREATE INDEX price_debug_snapshots_source_idx ON price_debug_snapshots (source_id, created_at DESC);
