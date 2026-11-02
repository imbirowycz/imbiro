import { z } from 'zod'
import type { WeatherDay, WeatherHour, WeatherNow } from '@myorg/shared'
import { defineModule } from '../../core/module.types'
import { RadarSourceError } from '../../core/radar.errors'
import { localToIso, localWithOffsetToIso } from '../../core/time'

// Open-Meteo (https://open-meteo.com): free for non-commercial use, no API key, CC BY 4.0.

const HOST = 'api.open-meteo.com'
const SOURCE = {
  name: 'Open-Meteo',
  homepage: 'https://open-meteo.com',
  attribution: 'Dane pogodowe: Open-Meteo.com (CC BY 4.0)',
}

export interface WeatherLocation {
  name: string
  latitude: number
  longitude: number
  timeZone: string
}

/** WMO weather interpretation codes → Polish description. */
const WMO: Record<number, string> = {
  0: 'bezchmurnie', 1: 'przeważnie bezchmurnie', 2: 'częściowe zachmurzenie', 3: 'pochmurno',
  45: 'mgła', 48: 'mgła osadzająca szadź',
  51: 'lekka mżawka', 53: 'mżawka', 55: 'gęsta mżawka', 56: 'marznąca mżawka', 57: 'gęsta marznąca mżawka',
  61: 'słaby deszcz', 63: 'deszcz', 65: 'ulewny deszcz', 66: 'marznący deszcz', 67: 'silny marznący deszcz',
  71: 'słaby śnieg', 73: 'śnieg', 75: 'intensywny śnieg', 77: 'ziarnisty śnieg',
  80: 'przelotny deszcz', 81: 'przelotne opady deszczu', 82: 'gwałtowne ulewy',
  85: 'przelotny śnieg', 86: 'intensywne opady śniegu',
  95: 'burza', 96: 'burza z gradem', 99: 'silna burza z gradem',
}

export function describeWeather(code: number): string {
  return WMO[code] ?? `kod pogody ${code}`
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
  windGusts: num,
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

export function createWeatherNowModule(location: WeatherLocation, hours: number) {
  return defineModule<WeatherNow>({
    id: 'weather.current',
    name: `Pogoda teraz – ${location.name}`,
    group: 'weather',
    category: 'current',
    description: `Aktualne warunki i prognoza godzinowa na ${hours} h`,
    source: SOURCE,
    itemKind: 'weather-now',
    kind: 'collector',
    allowedHosts: [HOST],
    itemSchema: weatherNowSchema,
    cacheTtlSeconds: 15 * 60,

    async execute({ http, signal }) {
      const query = baseQuery(location)
      query.set('current', 'temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,is_day')
      query.set('hourly', 'temperature_2m,precipitation_probability,precipitation,weather_code,wind_speed_10m')
      // Includes the current hour, so ask for one more.
      query.set('forecast_hours', String(hours + 1))
      const res = await http.getJson(`https://${HOST}/v1/forecast?${query}`, nowResponseSchema, { signal })
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
        dataAsOf: observedAt,
        data: [
          {
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
          },
        ],
      }
    },
  })
}

export function createWeatherForecastModule(location: WeatherLocation, days: number) {
  return defineModule<WeatherDay>({
    id: 'weather.forecast',
    name: `Prognoza ${days}-dniowa – ${location.name}`,
    group: 'weather',
    category: 'forecast',
    description: `Prognoza dzienna na ${days} dni: temperatura, opady, wiatr`,
    source: SOURCE,
    itemKind: 'weather-day',
    kind: 'collector',
    allowedHosts: [HOST],
    itemSchema: weatherDaySchema,
    cacheTtlSeconds: 60 * 60,

    async execute({ http, signal }) {
      const query = baseQuery(location)
      query.set('daily', 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset')
      query.set('forecast_days', String(days))
      const res = await http.getJson(`https://${HOST}/v1/forecast?${query}`, forecastResponseSchema, { signal })
      const d = res.daily

      return {
        data: d.time.map((date, i) => ({
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
        })),
      }
    },
  })
}
