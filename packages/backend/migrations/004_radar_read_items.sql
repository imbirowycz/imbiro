-- Personal Radar: newsy oznaczone jako przeczytane — nie są więcej pokazywane (dashboard, przegląd poranny).
-- Jeden użytkownik (admin), więc bez user_id. Wpisy starsze niż kilkanaście dni są usuwane przy zapisie
-- (newsy i tak mają najwyżej kilka dni), więc tabela zostaje mała.

CREATE TABLE radar_read_items (
  -- Kanoniczny URL artykułu (bez parametrów śledzących i #) — ten sam, który zwracają moduły radaru.
  url      TEXT PRIMARY KEY,
  title    TEXT,
  source   TEXT,
  read_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT radar_read_items_url_chk CHECK (url ~ '^https?://' AND length(url) <= 2000)
);

CREATE INDEX radar_read_items_read_at_idx ON radar_read_items (read_at);
