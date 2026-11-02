import { z } from 'zod'
import type { AlertItem, AlertSeverity } from '@myorg/shared'
import { defineModule } from '../../core/module.types'
import { RadarSourceError } from '../../core/radar.errors'
import { localToIso } from '../../core/time'
import { keywordMatcher } from '../../parsing/relevance'
import { truncate } from '../../parsing/text'
import { alertItemSchema, bySeverity } from './alert.schema'

// IMGW-PIB public data (https://danepubliczne.imgw.pl): meteorological warnings per powiat (TERYT)
// and hydrological warnings per catchment area. The terms require naming IMGW-PIB as the source.
// We only show what IMGW publishes — this is not a replacement for RCB alerts.

const HOST = 'danepubliczne.imgw.pl'
const API = `https://${HOST}/api/data`
const NO_END = '9999-12-31'

const meteoSchema = z.array(
  z.object({
    id: z.string(),
    nazwa_zdarzenia: z.string(),
    stopien: z.string(),
    prawdopodobienstwo: z.string().nullish(),
    obowiazuje_od: z.string().nullish(),
    obowiazuje_do: z.string().nullish(),
    opublikowano: z.string().nullish(),
    tresc: z.string().nullish(),
    teryt: z.array(z.string()),
  })
)

const hydroSchema = z.array(
  z.object({
    numer: z.string().nullish(),
    zdarzenie: z.string(),
    'stopień': z.string(),
    prawdopodobienstwo: z.string().nullish(),
    data_od: z.string().nullish(),
    data_do: z.string().nullish(),
    opublikowano: z.string().nullish(),
    przebieg: z.string().nullish(),
    biuro: z.string().nullish(),
    obszary: z.array(z.object({ wojewodztwo: z.string(), opis: z.string() })).default([]),
  })
)

/**
 * IMGW degree → severity. Meteo/hydro: 1 yellow, 2 orange, 3 red.
 * Hydro uses -1 for long-lasting drought warnings (often valid for months) — informational.
 */
function severity(degree: string): AlertSeverity {
  switch (degree.trim()) {
    case '3':
      return 'high'
    case '2':
      return 'medium'
    case '1':
      return 'low'
    default:
      return 'info'
  }
}

export interface ImgwOptions {
  locationName: string
  timeZone: string
  terytPowiat: string
  voivodeship: string
  hydroAreaKeywords: readonly string[]
}

export function createImgwModule(options: ImgwOptions) {
  const hydroMatchers = options.hydroAreaKeywords.map(keywordMatcher)
  const toIso = (value: string | null | undefined) =>
    value && !value.startsWith(NO_END) ? localToIso(value, options.timeZone) : null

  return defineModule<AlertItem>({
    id: 'alerts.imgw',
    name: 'Ostrzeżenia IMGW',
    group: 'alerts',
    category: 'weather',
    description: `Ostrzeżenia meteorologiczne dla powiatu ${options.locationName} i hydrologiczne (${options.voivodeship})`,
    source: {
      name: 'IMGW-PIB',
      homepage: 'https://meteo.imgw.pl',
      attribution: 'Źródłem pochodzenia danych jest Instytut Meteorologii i Gospodarki Wodnej – Państwowy Instytut Badawczy',
    },
    itemKind: 'alert',
    kind: 'collector',
    allowedHosts: [HOST],
    itemSchema: alertItemSchema,
    cacheTtlSeconds: 10 * 60,

    async execute({ http, signal, now }) {
      // Two independent requests: one failing still gives a partial result.
      const [meteoResult, hydroResult] = await Promise.allSettled([
        http.getJson(`${API}/warningsmeteo`, meteoSchema, { signal }),
        http.getJson(`${API}/warningshydro`, hydroSchema, { signal }),
      ])
      if (meteoResult.status === 'rejected' && hydroResult.status === 'rejected') {
        throw meteoResult.reason instanceof RadarSourceError ? meteoResult.reason : new RadarSourceError('NETWORK_ERROR', 'IMGW nie odpowiada')
      }

      const nowIso = now().toISOString()
      const active = (expiresAt: string | null) => expiresAt === null || expiresAt > nowIso
      const warnings: string[] = []
      const data: AlertItem[] = []

      if (meteoResult.status === 'fulfilled') {
        for (const w of meteoResult.value) {
          if (!w.teryt.includes(options.terytPowiat)) continue
          const expiresAt = toIso(w.obowiazuje_do)
          if (!active(expiresAt)) continue
          const probability = w.prawdopodobienstwo ? ` (prawdopodobieństwo ${w.prawdopodobienstwo}%)` : ''
          data.push({
            id: `imgw-meteo-${w.id}`,
            source: 'IMGW-PIB',
            category: 'weather',
            title: `${w.nazwa_zdarzenia} – stopień ${w.stopien}`,
            description: w.tresc ? truncate(`${w.tresc}${probability}`, 2000) : null,
            severity: severity(w.stopien),
            location: options.locationName,
            issuedAt: toIso(w.opublikowano),
            validFrom: toIso(w.obowiazuje_od),
            expiresAt,
            url: 'https://meteo.imgw.pl',
          })
        }
      } else {
        warnings.push('Nie udało się pobrać ostrzeżeń meteorologicznych')
      }

      if (hydroResult.status === 'fulfilled') {
        for (const [index, w] of hydroResult.value.entries()) {
          const areas = w.obszary.filter(
            (area) => area.wojewodztwo.toLowerCase() === options.voivodeship && hydroMatchers.some((m) => m.test(area.opis))
          )
          if (areas.length === 0) continue
          const expiresAt = toIso(w.data_do)
          if (!active(expiresAt)) continue
          // Area description looks like "mazowieckie, <river section>, <event>" — keep the river section.
          const place = areas.map((a) => a.opis.split(',')[1]?.trim() || a.opis).join(', ')
          data.push({
            id: `imgw-hydro-${w.numer ?? index}-${w.opublikowano ?? ''}`,
            source: 'IMGW-PIB',
            category: 'hydro',
            title: truncate(`${w.zdarzenie} – ${place}`, 300),
            description: truncate([w.przebieg, `Obszar: ${areas.map((a) => a.opis).join('; ')}`].filter(Boolean).join(' '), 2000),
            severity: severity(w['stopień']),
            location: place,
            issuedAt: toIso(w.opublikowano),
            validFrom: toIso(w.data_od),
            expiresAt,
            url: 'https://hydro.imgw.pl',
          })
        }
      } else {
        warnings.push('Nie udało się pobrać ostrzeżeń hydrologicznych')
      }

      return { data: data.sort(bySeverity), warnings }
    },
  })
}
