import type {
  PriceFetcher,
  PriceFetchMode,
  PriceObservation,
  PriceOffer,
  PriceOfferKind,
  PriceSource,
  PriceSourceDefinition,
  PriceSourceStatus,
} from '@myorg/shared'
import { pool, type Queryable } from '../../db'

// Dostęp do tabel price_*. Kwoty NUMERIC przychodzą z pg jako tekst — zamieniamy na liczby.

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
  fetch_mode: PriceFetchMode
  preferred_fetcher: PriceFetcher
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
  fetchMode: PriceFetchMode
  preferredFetcher: PriceFetcher
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
    fetchMode: row.fetch_mode,
    preferredFetcher: row.preferred_fetcher,
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
    fetchMode: source.fetchMode,
    preferredFetcher: source.preferredFetcher,
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
  fetchMode: PriceFetchMode
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

export interface OfferQuery {
  itemId?: string
  kind?: PriceOfferKind
  unread?: boolean
  from?: Date
  to?: Date
  q?: string
  cursor?: { detectedAt: Date; id: string }
  limit: number
}

export interface ObservationWrite {
  ok: boolean
  price: number | null
  oldPrice: number | null
  currency: string | null
  available: boolean | null
  title: string | null
  fetcher: PriceFetcher | null
  durationMs: number | null
  errorCode: string | null
  error: string | null
}

export class PricesRepository {
  // ---------- artykuły ----------

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

  // ---------- źródła ----------

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

  async insertSource(itemId: string, source: SourceWrite, db: Queryable): Promise<string> {
    const result = await db.query<{ id: string }>(
      `INSERT INTO price_sources (item_id, label, url, fetch_mode, parser_config, position)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [itemId, source.label, source.url, source.fetchMode, JSON.stringify(source.definition), source.position]
    )
    return result.rows[0].id
  }

  /**
   * Zmiana adresu, sposobu pobierania albo definicji resetuje stan źródła (to „nowe” źródło),
   * a zmiana samej nazwy czy kolejności — nie.
   */
  async updateSource(id: string, source: SourceWrite, db: Queryable): Promise<void> {
    await db.query(
      `UPDATE price_sources SET
         label = $2, position = $6,
         status = CASE WHEN url <> $3 OR fetch_mode <> $4 OR parser_config <> $5::jsonb THEN 'untested' ELSE status END,
         consecutive_failures = CASE WHEN url <> $3 OR fetch_mode <> $4 OR parser_config <> $5::jsonb THEN 0 ELSE consecutive_failures END,
         failing_alerted = CASE WHEN url <> $3 OR fetch_mode <> $4 OR parser_config <> $5::jsonb THEN FALSE ELSE failing_alerted END,
         preferred_fetcher = CASE WHEN url <> $3 OR fetch_mode <> $4 THEN 'http' ELSE preferred_fetcher END,
         url = $3, fetch_mode = $4, parser_config = $5::jsonb
       WHERE id = $1`,
      [id, source.label, source.url, source.fetchMode, JSON.stringify(source.definition), source.position]
    )
  }

  async deleteSourcesExcept(itemId: string, keepIds: string[], db: Queryable): Promise<void> {
    await db.query('DELETE FROM price_sources WHERE item_id = $1 AND NOT (id = ANY($2))', [itemId, keepIds])
  }

  async recordSuccess(
    id: string,
    data: { price: number; oldPrice: number | null; available: boolean | null; title: string | null; currency: string; fetcher: PriceFetcher },
    db: Queryable = pool
  ): Promise<void> {
    await db.query(
      `UPDATE price_sources SET
         status = 'ok', last_error = NULL, last_error_code = NULL, last_checked_at = NOW(), consecutive_failures = 0,
         failing_alerted = FALSE, last_price = $2, last_old_price = $3, last_available = $4,
         last_title = COALESCE($5, last_title), last_currency = $6, last_success_at = NOW(), preferred_fetcher = $7
       WHERE id = $1`,
      [id, data.price, data.oldPrice, data.available, data.title, data.currency, data.fetcher]
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

  // ---------- historia ----------

  async insertObservation(sourceId: string, o: ObservationWrite, db: Queryable = pool): Promise<void> {
    await db.query(
      `INSERT INTO price_observations
         (source_id, ok, price, old_price, currency, available, title, fetcher, duration_ms, error_code, error)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [sourceId, o.ok, o.price, o.oldPrice, o.currency, o.available, o.title, o.fetcher, o.durationMs, o.errorCode, o.error]
    )
  }

  async lastSuccessfulObservation(sourceId: string, db: Queryable = pool): Promise<{ price: number; available: boolean | null; checkedAt: Date } | null> {
    const result = await db.query<{ price: string; available: boolean | null; checked_at: Date }>(
      `SELECT price, available, checked_at FROM price_observations
       WHERE source_id = $1 AND ok ORDER BY checked_at DESC LIMIT 1`,
      [sourceId]
    )
    const row = result.rows[0]
    return row ? { price: Number(row.price), available: row.available, checkedAt: row.checked_at } : null
  }

  async minPriceSince(sourceId: string, since: Date, db: Queryable = pool): Promise<number | null> {
    const result = await db.query<{ min: string | null }>(
      'SELECT MIN(price) AS min FROM price_observations WHERE source_id = $1 AND ok AND checked_at >= $2',
      [sourceId, since]
    )
    return num(result.rows[0]?.min)
  }

  async history(sourceId: string, limit: number, db: Queryable = pool): Promise<PriceObservation[]> {
    const result = await db.query<{
      id: string
      checked_at: Date
      ok: boolean
      price: string | null
      old_price: string | null
      available: boolean | null
      fetcher: PriceFetcher | null
      duration_ms: number | null
      error_code: string | null
      error: string | null
    }>('SELECT * FROM price_observations WHERE source_id = $1 ORDER BY checked_at DESC LIMIT $2', [sourceId, limit])
    return result.rows.map((row) => ({
      id: row.id,
      checkedAt: row.checked_at.toISOString(),
      ok: row.ok,
      price: num(row.price),
      oldPrice: num(row.old_price),
      available: row.available,
      fetcher: row.fetcher,
      durationMs: row.duration_ms,
      errorCode: row.error_code,
      error: row.error,
    }))
  }

  // ---------- zrzuty HTML ----------

  async insertSnapshot(sourceId: string, data: { fetcher: string | null; httpStatus: number | null; errorCode: string; html: string }, keep = 3, db: Queryable = pool): Promise<void> {
    await db.query(
      'INSERT INTO price_debug_snapshots (source_id, fetcher, http_status, error_code, html) VALUES ($1, $2, $3, $4, $5)',
      [sourceId, data.fetcher, data.httpStatus, data.errorCode, data.html]
    )
    await db.query(
      `DELETE FROM price_debug_snapshots WHERE source_id = $1 AND id NOT IN (
         SELECT id FROM price_debug_snapshots WHERE source_id = $1 ORDER BY created_at DESC LIMIT $2)`,
      [sourceId, keep]
    )
  }

  async latestSnapshot(sourceId: string, db: Queryable = pool): Promise<{ html: string; createdAt: Date; fetcher: string | null; httpStatus: number | null } | null> {
    const result = await db.query<{ html: string; created_at: Date; fetcher: string | null; http_status: number | null }>(
      'SELECT html, created_at, fetcher, http_status FROM price_debug_snapshots WHERE source_id = $1 ORDER BY created_at DESC LIMIT 1',
      [sourceId]
    )
    const row = result.rows[0]
    return row ? { html: row.html, createdAt: row.created_at, fetcher: row.fetcher, httpStatus: row.http_status } : null
  }

  // ---------- okazje ----------

  async findVisibleOffer(sourceId: string, kind: PriceOfferKind, db: Queryable = pool): Promise<OfferRecord | null> {
    const result = await db.query<OfferRow>(
      'SELECT * FROM price_offers WHERE source_id = $1 AND kind = $2 AND dismissed_at IS NULL FOR UPDATE',
      [sourceId, kind]
    )
    return result.rows[0] ? toOfferRecord(result.rows[0]) : null
  }

  /** Najniższa cena spośród okazji usuniętych przez użytkownika (dla tego źródła i rodzaju). */
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

  /** Niższa cena w istniejącej okazji: nowe dane, nowa data, znów nieprzeczytana. */
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

  async listOffers(query: OfferQuery, db: Queryable = pool): Promise<PriceOffer[]> {
    const where: string[] = ['o.dismissed_at IS NULL']
    const params: unknown[] = []
    const add = (sql: string, value: unknown) => {
      params.push(value)
      where.push(sql.replace('?', `$${params.length}`))
    }
    if (query.itemId) add('o.item_id = ?', query.itemId)
    if (query.kind) add('o.kind = ?', query.kind)
    if (query.unread) where.push('o.read_at IS NULL')
    if (query.from) add('o.detected_at >= ?', query.from)
    if (query.to) add('o.detected_at <= ?', query.to)
    if (query.q) {
      params.push(`%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`)
      const n = params.length
      where.push(`(o.title ILIKE $${n} OR i.name ILIKE $${n} OR s.label ILIKE $${n})`)
    }
    if (query.cursor) {
      params.push(query.cursor.detectedAt, query.cursor.id)
      where.push(`(o.detected_at, o.id) < ($${params.length - 1}, $${params.length})`)
    }
    params.push(query.limit)
    const result = await db.query<OfferRow & { item_name: string; source_label: string; last_price: string | null; last_success_at: Date | null }>(
      `SELECT o.*, i.name AS item_name, s.label AS source_label, s.last_price, s.last_success_at
       FROM price_offers o
       JOIN price_items i ON i.id = o.item_id
       JOIN price_sources s ON s.id = o.source_id
       WHERE ${where.join(' AND ')}
       ORDER BY o.detected_at DESC, o.id DESC
       LIMIT $${params.length}`,
      params
    )
    return result.rows.map((row) => {
      const offer = toOfferRecord(row)
      return {
        id: offer.id,
        itemId: offer.itemId,
        itemName: row.item_name,
        sourceId: offer.sourceId,
        sourceLabel: row.source_label,
        kind: offer.kind,
        title: offer.title,
        url: offer.url,
        price: offer.price,
        previousPrice: offer.previousPrice,
        dropAmount: offer.dropAmount,
        dropPct: offer.dropPct,
        currency: offer.currency,
        detectedAt: offer.detectedAt.toISOString(),
        lastSeenAt: offer.lastSeenAt.toISOString(),
        readAt: iso(offer.readAt),
        currentPrice: num(row.last_price),
        currentCheckedAt: iso(row.last_success_at),
      }
    })
  }

  async offerCounts(db: Queryable = pool): Promise<Map<string, { visible: number; unread: number }>> {
    const result = await db.query<{ item_id: string; visible: string; unread: string }>(
      `SELECT item_id, COUNT(*) AS visible, COUNT(*) FILTER (WHERE read_at IS NULL) AS unread
       FROM price_offers WHERE dismissed_at IS NULL GROUP BY item_id`
    )
    return new Map(result.rows.map((r) => [r.item_id, { visible: Number(r.visible), unread: Number(r.unread) }]))
  }

  async markRead(ids: string[] | 'all', db: Queryable = pool): Promise<number> {
    const result =
      ids === 'all'
        ? await db.query('UPDATE price_offers SET read_at = NOW() WHERE read_at IS NULL AND dismissed_at IS NULL')
        : await db.query('UPDATE price_offers SET read_at = NOW() WHERE read_at IS NULL AND id = ANY($1)', [ids])
    return result.rowCount ?? 0
  }

  async dismiss(ids: string[], db: Queryable = pool): Promise<number> {
    const result = await db.query(
      'UPDATE price_offers SET dismissed_at = NOW(), read_at = COALESCE(read_at, NOW()) WHERE dismissed_at IS NULL AND id = ANY($1)',
      [ids]
    )
    return result.rowCount ?? 0
  }

  async unreadCount(db: Queryable = pool): Promise<number> {
    const result = await db.query<{ count: string }>('SELECT COUNT(*) AS count FROM price_offers WHERE read_at IS NULL AND dismissed_at IS NULL')
    return Number(result.rows[0].count)
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
