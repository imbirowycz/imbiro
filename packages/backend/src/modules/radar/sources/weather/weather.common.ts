// Shared by all weather sources (Open-Meteo, MET Norway).

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
  // 68/69 (rain and snow) are WMO 4677 codes Open-Meteo does not use; MET Norway's sleet maps to them.
  68: 'deszcz ze śniegiem', 69: 'silny deszcz ze śniegiem',
  95: 'burza', 96: 'burza z gradem', 99: 'silna burza z gradem',
}

export function describeWeather(code: number): string {
  return WMO[code] ?? `kod pogody ${code}`
}
