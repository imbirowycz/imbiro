import type { PriceChange, PriceOfferKind, PriceSource, PriceSourceDefinition, PriceSourceStatus } from '@myorg/shared'
import { pool, type Queryable } from '../../core/db'

// Access to the price_* tables. NUMERIC amounts arrive from pg as text — converted to numbers here.

const num = (value: unknown): number | null => (value === null || value === undefined ? null : Number(value))
const iso = (value: Date | null): string | null => (value ? value.toISOString() : null)

export interface ItemRow {
  id: string
  name: string
  description: string | null
  ean: string | null
  target_price: string | null
  min_drop_pct: string
  enabled: boolean
  notify_telegram: boolean
  telegram_chat_id: string | null
  notify_email: boolean
  email_to: string | null
  jitter_minutes: number
  scheduled_task_id: string
  created_at: Date
  updated_at: Date
}

export interface ItemRecord {
  id: string
  name: string
  description: string | null
  ean: string | null
  targetPrice: number | null
  minDropPct: number
  enabled: boolean
  notifyTelegram: boolean
  telegramChatId: string | null
  notifyEmail: boolean
  emailTo: string | null
  jitterMinutes: number
  scheduledTaskId: string
  createdAt: Date
  updatedAt: Date
}

export function toItemRecord(row: ItemRow): ItemRecord {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    ean: row.ean,
    targetPrice: num(row.target_price),
    minDropPct: Number(row.min_drop_pct),
    enabled: row.enabled,
    notifyTelegram: row.notify_telegram,
    telegramChatId: row.telegram_chat_id,
    notifyEmail: row.notify_email,
    emailTo: row.email_to,
    jitterMinutes: row.jitter_minutes,
    scheduledTaskId: row.scheduled_task_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

interface SourceRow {
  id: string
  item_id: string
  label: string
  url: string
  enabled: boolean
  parser_config: PriceSourceDefinition
  status: PriceSourceStatus
  last_error: string | null
  last_error_code: string | null
  last_checked_at: Date | null
  consecutive_failures: number
  failing_alerted: boolean
  last_price: string | null
  last_old_price: string | null
  last_available: boolean | null
  last_title: string | null
  last_currency: string | null
  last_success_at: Date | null
  position: number
}

export interface SourceRecord {
  id: string
  itemId: string
  label: string
  url: string
  enabled: boolean
  definition: PriceSourceDefinition
  status: PriceSourceStatus
  lastError: string | null
  lastErrorCode: string | null
  lastCheckedAt: Date | null
  consecutiveFailures: number
  failingAlerted: boolean
  lastPrice: number | null
  lastOldPrice: number | null
  lastAvailable: boolean | null
  lastTitle: string | null
  lastCurrency: string | null
  lastSuccessAt: Date | null
  position: number
}

function toSourceRecord(row: SourceRow): SourceRecord {
  return {
    id: row.id,
    itemId: row.item_id,
    label: row.label,
    url: row.url,
    enabled: row.enabled,
    definition: row.parser_config,
    status: row.status,
    lastError: row.last_error,
    lastErrorCode: row.last_error_code,
    lastCheckedAt: row.last_checked_at,
    consecutiveFailures: row.consecutive_failures,
    failingAlerted: row.failing_alerted,
    lastPrice: num(row.last_price),
    lastOldPrice: num(row.last_old_price),
    lastAvailable: row.last_available,
    lastTitle: row.last_title,
    lastCurrency: row.last_currency,
    lastSuccessAt: row.last_success_at,
    position: row.position,
  }
}

export function toSourceDto(source: SourceRecord): PriceSource {
  return {
    id: source.id,
    label: source.label,
    url: source.url,
    enabled: source.enabled,
    definition: source.definition,
    status: source.status,
    lastError: source.lastError,
    lastCheckedAt: iso(source.lastCheckedAt),
    consecutiveFailures: source.consecutiveFailures,
    lastPrice: source.lastPrice,
    lastOldPrice: source.lastOldPrice,
    lastAvailable: source.lastAvailable,
    lastTitle: source.lastTitle,
    position: source.position,
  }
}

export interface ItemWrite {
  name: string
  description: string | null
  ean: string | null
  targetPrice: number | null
  minDropPct: number
  enabled: boolean
  notifyTelegram: boolean
  telegramChatId: string | null
  notifyEmail: boolean
  emailTo: string | null
  jitterMinutes: number
}

export interface SourceWrite {
  label: string
  url: string
  enabled: boolean
  definition: PriceSourceDefinition
  position: number
}

export interface OfferRecord {
  id: string
  itemId: string
  sourceId: string
  kind: PriceOfferKind
  title: string
  url: string
  price: number
  previousPrice: number | null
  dropAmount: number | null
  dropPct: number | null
  currency: string
  detectedAt: Date
  lastSeenAt: Date
  dismissedAt: Date | null
  readAt: Date | null
}

interface OfferRow {
  id: string
  item_id: string
  source_id: string
  kind: PriceOfferKind
  title: string
  url: string
  price: string
  previous_price: string | null
  drop_amount: string | null
  drop_pct: string | null
  currency: string
  detected_at: Date
  last_seen_at: Date
  dismissed_at: Date | null
  read_at: Date | null
}

function toOfferRecord(row: OfferRow): OfferRecord {
  return {
    id: row.id,
    itemId: row.item_id,
    sourceId: row.source_id,
    kind: row.kind,
    title: row.title,
    url: row.url,
    price: Number(row.price),
    previousPrice: num(row.previous_price),
    dropAmount: num(row.drop_amount),
    dropPct: num(row.drop_pct),
    currency: row.currency,
    detectedAt: row.detected_at,
    lastSeenAt: row.last_seen_at,
    dismissedAt: row.dismissed_at,
    readAt: row.read_at,
  }
}

export interface OfferWrite {
  itemId: string
  sourceId: string
  kind: PriceOfferKind
  title: string
  url: string
  price: number
  previousPrice: number | null
  dropAmount: number | null
  dropPct: number | null
  currency: string
}

export interface ObservationWrite {
  ok: boolean
  price: number | null
  oldPrice: number | null
  currency: string | null
  available: boolean | null
  title: string | null
  durationMs: number | null
  errorCode: string | null
  error: string | null
}

export class PricesRepository {
  // ---------- items ----------

  async listItems(db: Queryable = pool): Promise<ItemRecord[]> {
    const result = await db.query<ItemRow>('SELECT * FROM price_items ORDER BY created_at DESC')
    return result.rows.map(toItemRecord)
  }

  async findItem(id: string, db: Queryable = pool, forUpdate = false): Promise<ItemRecord | null> {
    const result = await db.query<ItemRow>(`SELECT * FROM price_items WHERE id = $1${forUpdate ? ' FOR UPDATE' : ''}`, [id])
    return result.rows[0] ? toItemRecord(result.rows[0]) : null
  }

  async insertItem(id: string, item: ItemWrite, scheduledTaskId: string, db: Queryable): Promise<void> {
    await db.query(
      `INSERT INTO price_items
         (id, name, description, ean, target_price, min_drop_pct, enabled, notify_telegram, telegram_chat_id,
          notify_email, email_to, jitter_minutes, scheduled_task_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [id, ...itemParams(item), scheduledTaskId]
    )
  }

  async updateItem(id: string, item: ItemWrite, db: Queryable): Promise<void> {
    await db.query(
      `UPDATE price_items SET
         name = $2, description = $3, ean = $4, target_price = $5, min_drop_pct = $6, enabled = $7,
         notify_telegram = $8, telegram_chat_id = $9, notify_email = $10, email_to = $11, jitter_minutes = $12
       WHERE id = $1`,
      [id, ...itemParams(item)]
    )
  }

  async setItemEnabled(id: string, enabled: boolean, db: Queryable): Promise<void> {
    await db.query('UPDATE price_items SET enabled = $2 WHERE id = $1', [id, enabled])
  }

  async deleteItem(id: string, db: Queryable): Promise<void> {
    await db.query('DELETE FROM price_items WHERE id = $1', [id])
  }

  // ---------- sources ----------

  async listSources(itemIds: string[] | null, db: Queryable = pool): Promise<SourceRecord[]> {
    const result = itemIds
      ? await db.query<SourceRow>('SELECT * FROM price_sources WHERE item_id = ANY($1) ORDER BY position, created_at', [itemIds])
      : await db.query<SourceRow>('SELECT * FROM price_sources ORDER BY position, created_at')
    return result.rows.map(toSourceRecord)
  }

  async findSource(id: string, db: Queryable = pool): Promise<SourceRecord | null> {
    const result = await db.query<SourceRow>('SELECT * FROM price_sources WHERE id = $1', [id])
    return result.rows[0] ? toSourceRecord(result.rows[0]) : null
  }

  async insertSource(itemId: string, source: SourceWrite, db: Queryable = pool): Promise<string> {
    const result = await db.query<{ id: string }>(
      `INSERT INTO price_sources (item_id, label, url, enabled, parser_config, position)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [itemId, source.label, source.url, source.enabled, JSON.stringify(source.definition), source.position]
    )
    return result.rows[0].id
  }

  /**
   * A changed address or definition resets the source state (it is a "new" source);
   * a changed label, order or enabled flag does not.
   */
  async updateSource(id: string, source: SourceWrite, db: Queryable): Promise<void> {
    await db.query(
      `UPDATE price_sources SET
         label = $2, position = $6, enabled = $4,
         status = CASE WHEN url <> $3 OR parser_config <> $5::jsonb THEN 'untested' ELSE status END,
         consecutive_failures = CASE WHEN url <> $3 OR parser_config <> $5::jsonb THEN 0 ELSE consecutive_failures END,
         failing_alerted = CASE WHEN url <> $3 OR parser_config <> $5::jsonb THEN FALSE ELSE failing_alerted END,
         url = $3, parser_config = $5::jsonb
       WHERE id = $1`,
      [id, source.label, source.url, source.enabled, JSON.stringify(source.definition), source.position]
    )
  }

  async setSourceEnabled(id: string, enabled: boolean, db: Queryable = pool): Promise<void> {
    await db.query('UPDATE price_sources SET enabled = $2 WHERE id = $1', [id, enabled])
  }

  async deleteSource(id: string, db: Queryable = pool): Promise<void> {
    await db.query('DELETE FROM price_sources WHERE id = $1', [id])
  }

  async nextSourcePosition(itemId: string, db: Queryable = pool): Promise<number> {
    const result = await db.query<{ next: number }>('SELECT COALESCE(MAX(position) + 1, 0) AS next FROM price_sources WHERE item_id = $1', [itemId])
    return result.rows[0].next
  }

  async deleteSourcesExcept(itemId: string, keepIds: string[], db: Queryable): Promise<void> {
    await db.query('DELETE FROM price_sources WHERE item_id = $1 AND NOT (id = ANY($2))', [itemId, keepIds])
  }

  async recordSuccess(
    id: string,
    data: { price: number; oldPrice: number | null; available: boolean | null; title: string | null; currency: string },
    db: Queryable = pool
  ): Promise<void> {
    await db.query(
      `UPDATE price_sources SET
         status = 'ok', last_error = NULL, last_error_code = NULL, last_checked_at = NOW(), consecutive_failures = 0,
         failing_alerted = FALSE, last_price = $2, last_old_price = $3, last_available = $4,
         last_title = COALESCE($5, last_title), last_currency = $6, last_success_at = NOW()
       WHERE id = $1`,
      [id, data.price, data.oldPrice, data.available, data.title, data.currency]
    )
  }

  async recordFailure(
    id: string,
    data: { status: PriceSourceStatus; error: string; errorCode: string; failingAlerted?: boolean },
    db: Queryable = pool
  ): Promise<number> {
    const result = await db.query<{ consecutive_failures: number }>(
      `UPDATE price_sources SET
         status = $2, last_error = $3, last_error_code = $4, last_checked_at = NOW(),
         consecutive_failures = consecutive_failures + 1,
         failing_alerted = COALESCE($5, failing_alerted)
       WHERE id = $1 RETURNING consecutive_failures`,
      [id, data.status, data.error, data.errorCode, data.failingAlerted ?? null]
    )
    return result.rows[0]?.consecutive_failures ?? 0
  }

  async setFailingAlerted(id: string, db: Queryable = pool): Promise<void> {
    await db.query('UPDATE price_sources SET failing_alerted = TRUE WHERE id = $1', [id])
  }

  // ---------- measurements ----------

  async insertObservation(sourceId: string, o: ObservationWrite, db: Queryable = pool): Promise<void> {
    await db.query(
      `INSERT INTO price_observations
         (source_id, ok, price, old_price, currency, available, title, fetcher, duration_ms, error_code, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'browser', $8, $9, $10)`,
      [sourceId, o.ok, o.price, o.oldPrice, o.currency, o.available, o.title, o.durationMs, o.errorCode, o.error]
    )
  }

  /** Price changes of all sources of an item, newest first: only measurements whose price differs from the previous one. */
  async listChanges(itemId: string, limit: number, db: Queryable = pool): Promise<PriceChange[]> {
    const result = await db.query<{ source_id: string; label: string; checked_at: Date; price: string; previous: string | null; currency: string | null }>(
      `SELECT * FROM (
         SELECT o.source_id, s.label, o.checked_at, o.price, o.currency,
                LAG(o.price) OVER (PARTITION BY o.source_id ORDER BY o.checked_at) AS previous
           FROM price_observations o
           JOIN price_sources s ON s.id = o.source_id
          WHERE s.item_id = $1 AND o.ok AND o.price IS NOT NULL
       ) changes
       WHERE previous IS DISTINCT FROM price
       ORDER BY checked_at DESC
       LIMIT $2`,
      [itemId, limit]
    )
    return result.rows.map((row) => ({
      sourceId: row.source_id,
      sourceLabel: row.label,
      at: row.checked_at.toISOString(),
      price: Number(row.price),
      previousPrice: num(row.previous),
      currency: row.currency ?? 'PLN',
    }))
  }

  /** Failed measurements after 30 days, successful ones after a year (used by db.cleanup). */
  async deleteOld(db: Queryable = pool): Promise<number> {
    const result = await db.query(
      `DELETE FROM price_observations
        WHERE (NOT ok AND checked_at < NOW() - INTERVAL '30 days')
           OR checked_at < NOW() - INTERVAL '365 days'`
    )
    return result.rowCount ?? 0
  }

  // ---------- debug snapshots (HTML of the last failed checks) ----------

  async insertSnapshot(sourceId: string, data: { httpStatus: number | null; errorCode: string; html: string }, keep = 3, db: Queryable = pool): Promise<void> {
    await db.query(
      `INSERT INTO price_debug_snapshots (source_id, fetcher, http_status, error_code, html) VALUES ($1, 'browser', $2, $3, $4)`,
      [sourceId, data.httpStatus, data.errorCode, data.html]
    )
    await db.query(
      `DELETE FROM price_debug_snapshots WHERE source_id = $1 AND id NOT IN (
         SELECT id FROM price_debug_snapshots WHERE source_id = $1 ORDER BY created_at DESC LIMIT $2)`,
      [sourceId, keep]
    )
  }

  // ---------- collector ----------

  async touchCollector(hostname: string | null, db: Queryable = pool): Promise<void> {
    await db.query(
      `INSERT INTO price_collector_state (id, last_seen_at, hostname) VALUES (TRUE, NOW(), $1)
       ON CONFLICT (id) DO UPDATE SET last_seen_at = NOW(), hostname = EXCLUDED.hostname`,
      [hostname]
    )
  }

  async collectorState(db: Queryable = pool): Promise<{ lastSeenAt: Date; hostname: string | null } | null> {
    const result = await db.query<{ last_seen_at: Date; hostname: string | null }>('SELECT last_seen_at, hostname FROM price_collector_state')
    const row = result.rows[0]
    return row ? { lastSeenAt: row.last_seen_at, hostname: row.hostname } : null
  }

  // ---------- offers (deduplication of notifications) ----------

  async findVisibleOffer(sourceId: string, kind: PriceOfferKind, db: Queryable = pool): Promise<OfferRecord | null> {
    const result = await db.query<OfferRow>(
      'SELECT * FROM price_offers WHERE source_id = $1 AND kind = $2 AND dismissed_at IS NULL FOR UPDATE',
      [sourceId, kind]
    )
    return result.rows[0] ? toOfferRecord(result.rows[0]) : null
  }

  /** The lowest price among dismissed offers (for this source and kind). */
  async minDismissedPrice(sourceId: string, kind: PriceOfferKind, db: Queryable = pool): Promise<number | null> {
    const result = await db.query<{ min: string | null }>(
      'SELECT MIN(price) AS min FROM price_offers WHERE source_id = $1 AND kind = $2 AND dismissed_at IS NOT NULL',
      [sourceId, kind]
    )
    return num(result.rows[0]?.min)
  }

  async insertOffer(offer: OfferWrite, db: Queryable): Promise<OfferRecord> {
    const result = await db.query<OfferRow>(
      `INSERT INTO price_offers (item_id, source_id, kind, title, url, price, previous_price, drop_amount, drop_pct, currency)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [offer.itemId, offer.sourceId, offer.kind, offer.title, offer.url, offer.price, offer.previousPrice, offer.dropAmount, offer.dropPct, offer.currency]
    )
    return toOfferRecord(result.rows[0])
  }

  /** A lower price in an existing offer: new data, new date, notified again. */
  async replaceOffer(id: string, offer: OfferWrite, db: Queryable): Promise<OfferRecord> {
    const result = await db.query<OfferRow>(
      `UPDATE price_offers SET title = $2, url = $3, price = $4, previous_price = $5, drop_amount = $6, drop_pct = $7,
         currency = $8, detected_at = NOW(), last_seen_at = NOW(), read_at = NULL, notified_at = NULL, notify_error = NULL
       WHERE id = $1 RETURNING *`,
      [id, offer.title, offer.url, offer.price, offer.previousPrice, offer.dropAmount, offer.dropPct, offer.currency]
    )
    return toOfferRecord(result.rows[0])
  }

  async touchOffer(id: string, db: Queryable): Promise<void> {
    await db.query('UPDATE price_offers SET last_seen_at = NOW() WHERE id = $1', [id])
  }

  async markNotified(id: string, error: string | null, db: Queryable = pool): Promise<void> {
    await db.query('UPDATE price_offers SET notified_at = NOW(), notify_error = $2 WHERE id = $1', [id, error])
  }
}

function itemParams(item: ItemWrite): unknown[] {
  return [
    item.name,
    item.description,
    item.ean,
    item.targetPrice,
    item.minDropPct,
    item.enabled,
    item.notifyTelegram,
    item.telegramChatId,
    item.notifyEmail,
    item.emailTo,
    item.jitterMinutes,
  ]
}
