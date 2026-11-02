import { z } from 'zod'
import type { AirPollutant, AirPollutantCode, AirQualityStation, AlertSeverity } from '@myorg/shared'
import { mapWithLimit } from '../../core/module.runner'
import { defineModule } from '../../core/module.types'
import { RadarSourceError } from '../../core/radar.errors'
import { localToIso } from '../../core/time'
import type { HttpClient } from '../../http/safe-fetch'

// GIOŚ air quality API v1 (https://api.gios.gov.pl/pjp-api/v1/rest). Free, no key, JSON-LD
// with long Polish keys (copied exactly — including the source's own typo "wskażnika").
// Request budget per run: 1 index per station + up to 3 measurements for selected stations.
// The station list and sensors change rarely, so they are kept in memory for a day.

const HOST = 'api.gios.gov.pl'
const API = `https://${HOST}/pjp-api/v1/rest`
const DAY_MS = 24 * 3600_000
const POLLUTANTS: AirPollutantCode[] = ['PM10', 'PM2.5', 'NO2', 'SO2', 'O3']
const VALUE_POLLUTANTS: AirPollutantCode[] = ['PM10', 'PM2.5', 'NO2']
const REQUEST_CONCURRENCY = 3
// The API answers with JSON-LD and rejects `Accept: application/json` with 406.
const ACCEPT = 'application/ld+json, application/json;q=0.9'

const stationsSchema = z.object({
  'Lista stacji pomiarowych': z.array(
    z.object({ 'Identyfikator stacji': z.number().int(), 'Nazwa stacji': z.string(), 'Nazwa miasta': z.string() })
  ),
})

const sensorsSchema = z.object({
  'Lista stanowisk pomiarowych dla podanej stacji': z.array(
    z.object({ 'Identyfikator stanowiska': z.number().int(), 'Wskaźnik - kod': z.string() })
  ),
})

const indexSchema = z.object({ AqIndex: z.record(z.string(), z.unknown()) })

const dataSchema = z.object({
  'Lista danych pomiarowych': z.array(z.object({ Data: z.string(), 'Wartość': z.number().nullable() })),
})

const airQualitySchema: z.ZodType<AirQualityStation> = z.object({
  stationId: z.number().int(),
  name: z.string().min(1),
  indexValue: z.number().int().min(-1).max(5).nullable(),
  indexCategory: z.string().nullable(),
  criticalPollutant: z.string().nullable(),
  measuredAt: z.iso.datetime().nullable(),
  severity: z.enum(['info', 'low', 'medium', 'high']),
  pollutants: z.array(
    z.object({
      code: z.enum(['PM10', 'PM2.5', 'NO2', 'SO2', 'O3']),
      indexCategory: z.string().nullable(),
      value: z.number().nullable(),
      measuredAt: z.iso.datetime().nullable(),
    })
  ),
})

/** GIOŚ index: 0 very good, 1 good, 2 moderate, 3 sufficient, 4 bad, 5 very bad. */
export function airSeverity(index: number | null): AlertSeverity {
  if (index === null || index < 3) return 'info'
  if (index === 3) return 'low'
  if (index === 4) return 'medium'
  return 'high'
}

/** Tiny per-process memo for slow-changing reference data. */
function memo<T>(ttlMs: number) {
  const entries = new Map<string, { value: T; expiresAt: number }>()
  return async (key: string, load: () => Promise<T>): Promise<T> => {
    const hit = entries.get(key)
    if (hit && hit.expiresAt > Date.now()) return hit.value
    const value = await load()
    entries.set(key, { value, expiresAt: Date.now() + ttlMs })
    return value
  }
}

export interface GiosOptions {
  city: string
  timeZone: string
  valueStationIds: readonly number[]
}

export function createGiosModule(options: GiosOptions) {
  const stationsMemo = memo<{ id: number; name: string }[]>(DAY_MS)
  const sensorsMemo = memo<Map<string, number>>(DAY_MS)
  const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null)
  const int = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) ? value : null)

  async function latestValue(http: HttpClient, signal: AbortSignal, sensorId: number) {
    const res = await http.getJson(`${API}/data/getData/${sensorId}?size=6`, dataSchema, { signal, retries: 1, accept: ACCEPT })
    // Newest first; the last hour is often still empty (null).
    const latest = res['Lista danych pomiarowych'].find((row) => row['Wartość'] !== null)
    return latest ? { value: latest['Wartość'] as number, measuredAt: localToIso(latest.Data, options.timeZone) } : null
  }

  return defineModule<AirQualityStation>({
    id: 'alerts.gios',
    name: `Jakość powietrza – ${options.city}`,
    group: 'alerts',
    category: 'air',
    description: `Indeks jakości powietrza GIOŚ dla stacji w mieście ${options.city} (PM10, PM2.5, NO2)`,
    source: { name: 'GIOŚ', homepage: 'https://powietrze.gios.gov.pl', attribution: 'Dane: Główny Inspektorat Ochrony Środowiska' },
    itemKind: 'air-quality',
    kind: 'collector',
    allowedHosts: [HOST],
    itemSchema: airQualitySchema,
    // The index is recalculated hourly.
    cacheTtlSeconds: 30 * 60,
    timeoutMs: 30_000,

    async execute({ http, signal }) {
      const stations = await stationsMemo(options.city, async () => {
        const res = await http.getJson(`${API}/station/findAll?size=500`, stationsSchema, { signal, accept: ACCEPT })
        return res['Lista stacji pomiarowych']
          .filter((s) => s['Nazwa miasta'] === options.city)
          .map((s) => ({ id: s['Identyfikator stacji'], name: s['Nazwa stacji'] }))
      })
      if (stations.length === 0) throw new RadarSourceError('INVALID_RESPONSE', `GIOŚ nie zwrócił stacji dla miasta ${options.city}`)

      const indexes = await mapWithLimit(stations, REQUEST_CONCURRENCY, (station) =>
        http.getJson(`${API}/aqindex/getIndex/${station.id}`, indexSchema, { signal, retries: 1, accept: ACCEPT })
      )

      // Concentrations only for selected stations (sensor ids memoized for a day).
      const valueStations = stations.filter((s) => options.valueStationIds.includes(s.id))
      const values = new Map<string, { value: number; measuredAt: string | null }>()
      await mapWithLimit(valueStations, REQUEST_CONCURRENCY, async (station) => {
        const sensors = await sensorsMemo(String(station.id), async () => {
          const res = await http.getJson(`${API}/station/sensors/${station.id}`, sensorsSchema, { signal, retries: 1, accept: ACCEPT })
          return new Map(res['Lista stanowisk pomiarowych dla podanej stacji'].map((s) => [s['Wskaźnik - kod'], s['Identyfikator stanowiska']]))
        })
        for (const code of VALUE_POLLUTANTS) {
          const sensorId = sensors.get(code)
          if (sensorId === undefined) continue
          const latest = await latestValue(http, signal, sensorId).catch(() => null)
          if (latest) values.set(`${station.id}:${code}`, latest)
        }
      })

      const warnings: string[] = []
      const data: AirQualityStation[] = []
      indexes.forEach((outcome, i) => {
        const station = stations[i]
        if (outcome.status === 'rejected') {
          warnings.push(`Brak indeksu dla stacji ${station.name}`)
          return
        }
        const index = outcome.value.AqIndex
        const indexValue = int(index['Wartość indeksu'])
        const pollutants: AirPollutant[] = POLLUTANTS.map((code) => {
          const measured = values.get(`${station.id}:${code}`)
          return {
            code,
            indexCategory: str(index[`Nazwa kategorii indeksu dla wskażnika ${code}`]),
            value: measured?.value ?? null,
            measuredAt: measured?.measuredAt ?? null,
          }
        }).filter((p) => p.indexCategory !== null || p.value !== null)

        data.push({
          stationId: station.id,
          name: station.name.replace(new RegExp(`^${options.city},\\s*`), ''),
          // -1 means "index not computed".
          indexValue: indexValue !== null && indexValue >= 0 ? indexValue : null,
          indexCategory: str(index['Nazwa kategorii indeksu']),
          criticalPollutant: str(index['Kod zanieczyszczenia krytycznego']),
          measuredAt: localToIso(str(index['Data danych źródłowych, z których policzono wartość indeksu dla wskaźnika st']), options.timeZone),
          severity: airSeverity(indexValue),
          pollutants,
        })
      })
      if (data.length === 0) throw new RadarSourceError('HTTP_ERROR', 'GIOŚ nie zwrócił indeksu dla żadnej stacji')

      // Worst air first.
      data.sort((a, b) => (b.indexValue ?? -1) - (a.indexValue ?? -1))
      return { data, warnings, dataAsOf: data.map((s) => s.measuredAt).filter(Boolean).sort().at(-1) ?? null }
    },
  })
}
