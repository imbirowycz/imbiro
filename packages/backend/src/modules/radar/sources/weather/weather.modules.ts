import { z } from 'zod'
import type { WeatherDay, WeatherHour, WeatherNow } from '@myorg/shared'
import { defineModule } from '../../core/module.types'
import { RadarSourceError } from '../../core/radar.errors'
import { localToIso, localWithOffsetToIso } from '../../core/time'
import type { HttpClient } from '../../http/safe-fetch'
import { MET_HOST, MET_SOURCE, type MetNorwayClient } from './met-norway'
import { describeWeather, type WeatherLocation } from './weather.common'

// Weather modules. Primary source: Open-Meteo (https://open-meteo.com) — free for non-commercial use,
// no API key, CC BY 4.0. When it fails (e.g. 503 "service overloaded"), MET Norway is asked instead;
// the result then names MET Norway as its source. Both down → module error (stale-if-error may cover it).

const HOST = 'api.open-meteo.com'
const SOURCE = {
  name: 'Open-Meteo',
  homepage: 'https://open-meteo.com',
  attribution: 'Dane pogodowe: Open-Meteo.com (CC BY 4.0)',
}

const num = z.number()
const nullableNum = z.number().nullable()

const nowResponseSchema = z.object({
  utc_offset_seconds: z.number().int(),
  current: z.object({
    time: z.string(),
    temperature_2m: num,
    apparent_temperature: num,
    relative_humidity_2m: num,
    precipitation: num,
    weather_code: z.number().int(),
    wind_speed_10m: num,
    wind_gusts_10m: num,
    is_day: z.number().int(),
  }),
  hourly: z.object({
    time: z.array(z.string()),
    temperature_2m: z.array(num),
    precipitation_probability: z.array(nullableNum),
    precipitation: z.array(num),
    weather_code: z.array(z.number().int()),
    wind_speed_10m: z.array(num),
  }),
})

const forecastResponseSchema = z.object({
  utc_offset_seconds: z.number().int(),
  daily: z.object({
    time: z.array(z.string()),
    weather_code: z.array(z.number().int()),
    temperature_2m_max: z.array(num),
    temperature_2m_min: z.array(num),
    precipitation_sum: z.array(num),
    precipitation_probability_max: z.array(nullableNum),
    wind_speed_10m_max: z.array(num),
    sunrise: z.array(z.string()),
    sunset: z.array(z.string()),
  }),
})

const isoOrThrow = (local: string, offset: number) => {
  const iso = localWithOffsetToIso(local, offset)
  if (!iso) throw new RadarSourceError('INVALID_RESPONSE', 'Nieprawidłowa data w odpowiedzi Open-Meteo')
  return iso
}

const hourSchema: z.ZodType<WeatherHour> = z.object({
  time: z.iso.datetime(),
  temperature: num,
  precipitationProbability: nullableNum,
  precipitation: num,
  weatherCode: z.number().int(),
  description: z.string(),
  windSpeed: num,
})

const weatherNowSchema: z.ZodType<WeatherNow> = z.object({
  location: z.string(),
  observedAt: z.iso.datetime(),
  temperature: num,
  apparentTemperature: num,
  humidity: num,
  precipitation: num,
  windSpeed: num,
  windGusts: nullableNum,
  weatherCode: z.number().int(),
  description: z.string(),
  isDay: z.boolean(),
  hours: z.array(hourSchema),
})

const weatherDaySchema: z.ZodType<WeatherDay> = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weatherCode: z.number().int(),
  description: z.string(),
  temperatureMin: num,
  temperatureMax: num,
  precipitationSum: num,
  precipitationProbabilityMax: nullableNum,
  windSpeedMax: num,
  sunrise: z.iso.datetime().nullable(),
  sunset: z.iso.datetime().nullable(),
})

function baseQuery(location: WeatherLocation): URLSearchParams {
  return new URLSearchParams({
    latitude: String(location.latitude),
    longitude: String(location.longitude),
    timezone: location.timeZone,
    wind_speed_unit: 'kmh',
  })
}

/** Primary source tried with a single retry, so the fallback kicks in within a few seconds. */
const PRIMARY_RETRIES = 1

async function openMeteoNow(http: HttpClient, signal: AbortSignal, location: WeatherLocation, hours: number): Promise<WeatherNow> {
  const query = baseQuery(location)
  query.set('current', 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,is_day')
  query.set('hourly', 'temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m')
  // Includes the current hour, so ask for one more.
  query.set('forecast_hours', String(hours + 1))
  const res = await http.getJson(`https://${HOST}/v1/forecast?${query}`, nowResponseSchema, { signal, retries: PRIMARY_RETRIES })
  const offset = res.utc_offset_seconds
  const { current: c, hourly: h } = res

  const observedAt = isoOrThrow(c.time, offset)
  const allHours = h.time.map((time, i) => ({
    // Per-hour conversion with the time zone: the next hours may cross a DST change.
    time: localToIso(time, location.timeZone) ?? isoOrThrow(time, offset),
    temperature: h.temperature_2m[i],
    precipitationProbability: h.precipitation_probability[i] ?? null,
    precipitation: h.precipitation[i],
    weatherCode: h.weather_code[i],
    description: describeWeather(h.weather_code[i]),
    windSpeed: h.wind_speed_10m[i],
  }))

  return {
    location: location.name,
    observedAt,
    temperature: c.temperature_2m,
    apparentTemperature: c.apparent_temperature,
    humidity: c.relative_humidity_2m,
    precipitation: c.precipitation,
    windSpeed: c.wind_speed_10m,
    windGusts: c.wind_gusts_10m,
    weatherCode: c.weather_code,
    description: describeWeather(c.weather_code),
    isDay: c.is_day === 1,
    // Only hours after the observation (the first hourly slot is the current hour).
    hours: allHours.filter((hour) => hour.time > observedAt).slice(0, hours),
  }
}

async function openMeteoDays(http: HttpClient, signal: AbortSignal, location: WeatherLocation, days: number): Promise<WeatherDay[]> {
  const query = baseQuery(location)
  query.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset')
  query.set('forecast_days', String(days))
  const res = await http.getJson(`https://${HOST}/v1/forecast?${query}`, forecastResponseSchema, { signal, retries: PRIMARY_RETRIES })
  const d = res.daily
  return d.time.map((date, i) => ({
    date,
    weatherCode: d.weather_code[i],
    description: describeWeather(d.weather_code[i]),
    temperatureMin: d.temperature_2m_min[i],
    temperatureMax: d.temperature_2m_max[i],
    precipitationSum: d.precipitation_sum[i],
    precipitationProbabilityMax: d.precipitation_probability_max[i] ?? null,
    windSpeedMax: d.wind_speed_10m_max[i],
    // Converted with the time zone, not today's offset: the forecast may cross a DST change.
    sunrise: localToIso(d.sunrise[i], location.timeZone),
    sunset: localToIso(d.sunset[i], location.timeZone),
  }))
}

/** Runs the primary source, then the fallback; reports which one delivered. */
async function withFallback<T>(
  primary: () => Promise<T>,
  fallback: () => Promise<T>,
  log: (message: string) => void
): Promise<{ value: T; usedFallback: boolean }> {
  try {
    return { value: await primary(), usedFallback: false }
  } catch (primaryError) {
    const reason = primaryError instanceof RadarSourceError ? primaryError.message : 'błąd'
    log(`Open-Meteo failed (${reason}), trying MET Norway`)
    try {
      return { value: await fallback(), usedFallback: true }
    } catch (fallbackError) {
      const code = primaryError instanceof RadarSourceError ? primaryError.code : 'NETWORK_ERROR'
      const fallbackReason = fallbackError instanceof RadarSourceError ? fallbackError.message : 'błąd'
      throw new RadarSourceError(code, `Open-Meteo (${reason}) i MET Norway (${fallbackReason}) nie odpowiadają`)
    }
  }
}

export function createWeatherNowModule(location: WeatherLocation, hours: number, met: MetNorwayClient) {
  return defineModule<WeatherNow>({
    id: 'weather.current',
    name: `Pogoda teraz – ${location.name}`,
    group: 'weather',
    category: 'current',
    description: `Aktualne warunki i prognoza godzinowa na ${hours} h (Open-Meteo, zapasowo MET Norway)`,
    source: SOURCE,
    itemKind: 'weather-now',
    kind: 'collector',
    allowedHosts: [HOST, MET_HOST],
    itemSchema: weatherNowSchema,
    cacheTtlSeconds: 15 * 60,

    async execute({ http, signal, now, log }) {
      const { value, usedFallback } = await withFallback(
        () => openMeteoNow(http, signal, location, hours),
        () => met.now(http, signal, hours, now()),
        log
      )
      return { data: [value], dataAsOf: value.observedAt, ...(usedFallback ? { source: MET_SOURCE } : {}) }
    },
  })
}

export function createWeatherForecastModule(location: WeatherLocation, days: number, met: MetNorwayClient) {
  return defineModule<WeatherDay>({
    id: 'weather.forecast',
    name: `Prognoza ${days}-dniowa – ${location.name}`,
    group: 'weather',
    category: 'forecast',
    description: `Prognoza dzienna na ${days} dni: temperatura, opady, wiatr (Open-Meteo, zapasowo MET Norway)`,
    source: SOURCE,
    itemKind: 'weather-day',
    kind: 'collector',
    allowedHosts: [HOST, MET_HOST],
    itemSchema: weatherDaySchema,
    cacheTtlSeconds: 60 * 60,

    async execute({ http, signal, log }) {
      const { value, usedFallback } = await withFallback(
        () => openMeteoDays(http, signal, location, days),
        () => met.days(http, signal, days),
        log
      )
      return { data: value, ...(usedFallback ? { source: MET_SOURCE } : {}) }
    },
  })
}
