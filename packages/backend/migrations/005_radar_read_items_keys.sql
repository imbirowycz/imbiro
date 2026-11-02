-- Personal Radar: „przeczytane” także dla alertów. Zamiast samego URL-a — ogólny klucz:
--   news:<kanoniczny URL>          (newsy)
--   alert:<id>|<czas wydania>      (alerty; zmieniona wersja ostrzeżenia ma nowy klucz i znów się pokazuje)
-- Każdy wpis ma własny termin ważności (expires_at): newsy 14 dni, alerty do końca ważności alertu + 1 dzień
-- (bez terminu: 60 dni). Istniejące oznaczenia newsów są zachowane.

ALTER TABLE radar_read_items DROP CONSTRAINT radar_read_items_url_chk;
ALTER TABLE radar_read_items RENAME COLUMN url TO item_key;
ALTER TABLE radar_read_items ADD COLUMN expires_at TIMESTAMPTZ;

UPDATE radar_read_items
SET item_key = 'news:' || item_key,
    expires_at = read_at + INTERVAL '14 days';

ALTER TABLE radar_read_items ALTER COLUMN expires_at SET NOT NULL;
ALTER TABLE radar_read_items ADD CONSTRAINT radar_read_items_key_chk
  CHECK (item_key ~ '^(news:https?://|alert:).+' AND length(item_key) <= 2100);

DROP INDEX radar_read_items_read_at_idx;
CREATE INDEX radar_read_items_expires_at_idx ON radar_read_items (expires_at);
