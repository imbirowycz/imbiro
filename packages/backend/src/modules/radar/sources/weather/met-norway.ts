import { z } from 'zod'
import type { WeatherDay, WeatherNow } from '@myorg/shared'
import type { HttpClient } from '../../http/safe-fetch'
import { describeWeather, type WeatherLocation } from './weather.common'

// MET Norway Locationforecast 2.0 (https://api.met.no) — fallback weather source.
// Free, no API key, CC BY 4.0. Terms: identify the app in User-Agent (done in safe-fetch),
// at most 4 decimals in coordinates, respect caching (Expires ≈ 30 min) — one shared fetch per 30 min.

export const MET_HOST = 'api.met.no'
export const MET_SOURCE = {
  name: 'MET Norway (zapasowe)',
  homepage: 'https://api.met.no',
  attribution: 'Dane pogodowe: Norweski Instytut Meteorologiczny (MET Norway), CC BY 4.0',
}

const CACHE_MS = 30 * 60_000

const responseSchema = z.object({
  properties: z.object({
    timeseries: z
      .array(
        z.object({
          time: z.iso.datetime(),
          data: z.object({
            instant: z.object({
              details: z.object({
                air_temperature: z.number(),
                apparent_air_temperature: z.number().optional(),
                relative_humidity: z.number(),
                wind_speed: z.number(),
              }),
            }),
            next_1_hours: z
              .object({ summary: z.object({ symbol_code: z.string() }), details: z.object({ precipitation_amount: z.number().optional() }) })
              .optional(),
            next_6_hours: z
              .object({ summary: z.object({ symbol_code: z.string() }), details: z.object({ precipitation_amount: z.number().optional() }) })
              .optional(),
          }),
        })
      )
      .min(1),
  }),
})

type Step = z.infer<typeof responseSchema>['properties']['timeseries'][number]

/**
 * MET symbol codes (e.g. "lightrainshowers_day", "heavysnowandthunder") → WMO weather codes,
 * so both sources share one description table and the same icons later.
 */
export function symbolToWmo(symbol: string): number {
  const s = symbol.replace(/_(day|night|polartwilight)$/, '')
  if (s.includes('thunder')) return 95
  const table: Record<string, number> = {
    clearsky: 0, fair: 1, partlycloudy: 2, cloudy: 3, fog: 45,
    lightrain: 61, rain: 63, heavyrain: 65,
    lightrainshowers: 80, rainshowers: 81, heavyrainshowers: 82,
    // Sleet = rain and snow (WMO 68/69), not freezing rain.
    lightsleet: 68, sleet: 68, heavysleet: 69, lightsleetshowers: 68, sleetshowers: 68, heavysleetshowers: 69,
    lightsnow: 71, snow: 73, heavysnow: 75, lightsnowshowers: 85, snowshowers: 85, heavysnowshowers: 86,
  }
  return table[s] ?? 3
}

const kmh = (ms: number) => Math.round(ms * 3.6 * 10) / 10

export function createMetNorwayClient(location: WeatherLocation) {
  let cached: { at: number; promise: Promise<Step[]> } | null = null
  const lat = location.latitude.toFixed(4)
  const lon = location.longitude.toFixed(4)

  /** One request shared by weather.current and weather.forecast (and by concurrent callers). */
  function series(http: HttpClient, signal: AbortSignal): Promise<Step[]> {
    if (cached && Date.now() - cached.at < CACHE_MS) return cached.promise
    const promise = http
      .getJson(`https://${MET_HOST}/weatherapi/locationforecast/2.0/complete?lat=${lat}&lon=${lon}`, responseSchema, { signal, retries: 1 })
      .then((res) => res.properties.timeseries)
    cached = { at: Date.now(), promise }
    // A failed request must not be remembered.
    promise.catch(() => {
      if (cached?.promise === promise) cached = null
    })
    return promise
  }

  async function now(http: HttpClient, signal: AbortSignal, hours: number, at: Date): Promise<WeatherNow> {
    const steps = await series(http, signal)
    // The step for the current hour (or the first one, if the forecast starts later).
    const current = [...steps].reverse().find((s) => Date.parse(s.time) <= at.getTime()) ?? steps[0]
    const d = current.data.instant.details
    const code = symbolToWmo(current.data.next_1_hours?.summary.symbol_code ?? current.data.next_6_hours?.summary.symbol_code ?? 'cloudy')
    return {
      location: location.name,
      observedAt: current.time,
      temperature: d.air_temperature,
      apparentTemperature: d.apparent_air_temperature ?? d.air_temperature,
      humidity: d.relative_humidity,
      precipitation: current.data.next_1_hours?.details.precipitation_amount ?? 0,
      windSpeed: kmh(d.wind_speed),
      windGusts: null,
      weatherCode: code,
      description: describeWeather(code),
      isDay: !(current.data.next_1_hours?.summary.symbol_code ?? '').endsWith('_night'),
      hours: steps
        .filter((s) => s.time > current.time && s.data.next_1_hours)
        .slice(0, hours)
        .map((s) => {
          const hourCode = symbolToWmo(s.data.next_1_hours!.summary.symbol_code)
          return {
            time: s.time,
            temperature: s.data.instant.details.air_temperature,
            precipitationProbability: null,
            precipitation: s.data.next_1_hours!.details.precipitation_amount ?? 0,
            weatherCode: hourCode,
            description: describeWeather(hourCode),
            windSpeed: kmh(s.data.instant.details.wind_speed),
          }
        }),
    }
  }

  async function days(http: HttpClient, signal: AbortSignal, count: number): Promise<WeatherDay[]> {
    const steps = await series(http, signal)
    const localDate = (iso: string) => new Date(iso).toLocaleDateString('en-CA', { timeZone: location.timeZone })
    const localHour = (iso: string) => Number(new Date(iso).toLocaleTimeString('en-GB', { timeZone: location.timeZone, hour: '2-digit' }))

    const byDay = new Map<string, Step[]>()
    for (const step of steps) byDay.set(localDate(step.time), [...(byDay.get(localDate(step.time)) ?? []), step])

    return [...byDay.entries()].slice(0, count).map(([date, list]) => {
      const temps = list.map((s) => s.data.instant.details.air_temperature)
      // Hourly steps carry 1 h precipitation; later (6-hourly) steps carry 6 h sums — never both counted.
      const precipitation = list.reduce(
        (sum, s) => sum + (s.data.next_1_hours?.details.precipitation_amount ?? s.data.next_6_hours?.details.precipitation_amount ?? 0),
        0
      )
      // The day's symbol: the step closest to midday.
      const midday = [...list].sort((a, b) => Math.abs(localHour(a.time) - 12) - Math.abs(localHour(b.time) - 12))[0]
      const code = symbolToWmo(midday.data.next_6_hours?.summary.symbol_code ?? midday.data.next_1_hours?.summary.symbol_code ?? 'cloudy')
      return {
        date,
        weatherCode: code,
        description: describeWeather(code),
        temperatureMin: Math.min(...temps),
        temperatureMax: Math.max(...temps),
        precipitationSum: Math.round(precipitation * 10) / 10,
        precipitationProbabilityMax: null,
        windSpeedMax: kmh(Math.max(...list.map((s) => s.data.instant.details.wind_speed))),
        sunrise: null,
        sunset: null,
      }
    })
  }

  return { now, days }
}

export type MetNorwayClient = ReturnType<typeof createMetNorwayClient>
