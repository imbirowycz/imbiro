-- Scheduler MVP: definicje zadań i historia wykonań.

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE scheduled_tasks (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title            TEXT NOT NULL,
  description      TEXT,
  enabled          BOOLEAN NOT NULL DEFAULT TRUE,

  -- Typ akcji to klucz w Action Registry (np. 'email.send'); bez enuma,
  -- żeby nowa akcja nie wymagała migracji.
  action_type      TEXT NOT NULL,
  action_config    JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- once: {} | cron: {"expression": "..."} | interval: {"everySeconds": 1800}
  schedule_type    TEXT NOT NULL,
  schedule_config  JSONB NOT NULL DEFAULT '{}'::jsonb,
  start_at         TIMESTAMPTZ NOT NULL,
  end_at           TIMESTAMPTZ,
  timezone         TEXT NOT NULL DEFAULT 'UTC',

  -- Najbliższy termin do zaplanowania; NULL = brak kolejnych terminów.
  next_run_at      TIMESTAMPTZ,
  -- Podbijana przy każdej zmianie harmonogramu/aktywności; joby ze starą wersją są pomijane.
  schedule_version INTEGER NOT NULL DEFAULT 1,

  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT scheduled_tasks_title_chk CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  CONSTRAINT scheduled_tasks_action_type_chk CHECK (action_type ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  CONSTRAINT scheduled_tasks_action_config_chk CHECK (jsonb_typeof(action_config) = 'object'),
  CONSTRAINT scheduled_tasks_schedule_type_chk CHECK (schedule_type IN ('once', 'cron', 'interval')),
  CONSTRAINT scheduled_tasks_schedule_config_chk CHECK (jsonb_typeof(schedule_config) = 'object'),
  CONSTRAINT scheduled_tasks_end_after_start_chk CHECK (end_at IS NULL OR end_at > start_at),
  CONSTRAINT scheduled_tasks_timezone_chk CHECK (char_length(timezone) BETWEEN 1 AND 64),
  CONSTRAINT scheduled_tasks_schedule_version_chk CHECK (schedule_version >= 1)
);

-- Szukanie zaległych terminów (reconcile) dotyczy tylko aktywnych zadań.
CREATE INDEX scheduled_tasks_due_idx
  ON scheduled_tasks (next_run_at)
  WHERE enabled AND next_run_at IS NOT NULL;

CREATE INDEX scheduled_tasks_created_at_idx ON scheduled_tasks (created_at DESC);

CREATE TRIGGER scheduled_tasks_set_updated_at
  BEFORE UPDATE ON scheduled_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE task_executions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id        UUID NOT NULL REFERENCES scheduled_tasks (id) ON DELETE CASCADE,
  trigger        TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',
  scheduled_for  TIMESTAMPTZ NOT NULL,
  started_at     TIMESTAMPTZ,
  finished_at    TIMESTAMPTZ,
  attempts       INTEGER NOT NULL DEFAULT 0,
  error          TEXT,
  result         JSONB,
  -- Id joba pg-boss, pomocniczo przy diagnozie.
  job_id         TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT task_executions_trigger_chk CHECK (trigger IN ('schedule', 'manual')),
  CONSTRAINT task_executions_status_chk CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
  CONSTRAINT task_executions_attempts_chk CHECK (attempts >= 0),
  CONSTRAINT task_executions_running_started_chk CHECK (status <> 'running' OR started_at IS NOT NULL),
  CONSTRAINT task_executions_finished_chk CHECK (status NOT IN ('succeeded', 'failed') OR finished_at IS NOT NULL),
  CONSTRAINT task_executions_finished_after_start_chk CHECK (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at)
);

-- Jeden zaplanowany termin danego zadania = jedno wykonanie (ochrona przed podwójnym przetworzeniem).
CREATE UNIQUE INDEX task_executions_schedule_slot_uq
  ON task_executions (task_id, scheduled_for)
  WHERE trigger = 'schedule';

-- Historia wykonań zadania.
CREATE INDEX task_executions_task_history_idx ON task_executions (task_id, created_at DESC);

-- Odzyskiwanie przerwanych wykonań.
CREATE INDEX task_executions_unfinished_idx
  ON task_executions (status, updated_at)
  WHERE status IN ('pending', 'running');

CREATE TRIGGER task_executions_set_updated_at
  BEFORE UPDATE ON task_executions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
