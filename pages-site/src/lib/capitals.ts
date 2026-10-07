export type Capital = {
  id: string
  name: string
  lat: number
  lon: number
  timezone: string
}

export const CAPITALS: Capital[] = [
  { id: 'syd', name: 'Sydney', lat: -33.87, lon: 151.21, timezone: 'Australia/Sydney' },
  { id: 'mel', name: 'Melbourne', lat: -37.81, lon: 144.96, timezone: 'Australia/Melbourne' },
  { id: 'bne', name: 'Brisbane', lat: -27.47, lon: 153.03, timezone: 'Australia/Brisbane' },
  { id: 'per', name: 'Perth', lat: -31.95, lon: 115.86, timezone: 'Australia/Perth' },
  { id: 'adl', name: 'Adelaide', lat: -34.93, lon: 138.6, timezone: 'Australia/Adelaide' },
  { id: 'hba', name: 'Hobart', lat: -42.88, lon: 147.33, timezone: 'Australia/Hobart' },
  { id: 'cbr', name: 'Canberra', lat: -35.28, lon: 149.13, timezone: 'Australia/Sydney' },
  { id: 'drw', name: 'Darwin', lat: -12.46, lon: 130.84, timezone: 'Australia/Darwin' },
]

export type CapitalForecast = {
  id: string
  name: string
  lat: number
  lon: number
  tempC: number | null
  feelsLikeC: number | null
  weatherCode: number | null
  windKmh: number | null
  precipMm: number | null
  precipProb: number | null
  maxC: number | null
  minC: number | null
}

type OpenMeteoPoint = {
  latitude: number
  longitude: number
  current?: {
    temperature_2m?: number
    apparent_temperature?: number
    weather_code?: number
    wind_speed_10m?: number
    precipitation?: number
  }
  daily?: {
    temperature_2m_max?: number[]
    temperature_2m_min?: number[]
    precipitation_probability_max?: number[]
  }
}

const WMO_LABELS: Record<number, string> = {
  0: 'Clear',
  1: 'Mainly clear',
  2: 'Partly cloudy',
  3: 'Overcast',
  45: 'Fog',
  48: 'Rime fog',
  51: 'Light drizzle',
  53: 'Drizzle',
  55: 'Heavy drizzle',
  61: 'Light rain',
  63: 'Rain',
  65: 'Heavy rain',
  66: 'Freezing rain',
  67: 'Heavy freezing rain',
  71: 'Light snow',
  73: 'Snow',
  75: 'Heavy snow',
  80: 'Showers',
  81: 'Showers',
  82: 'Heavy showers',
  95: 'Thunderstorm',
  96: 'Thunderstorm',
  99: 'Severe thunderstorm',
}

export function weatherLabel(code: number | null): string {
  if (code == null) return '—'
  return WMO_LABELS[code] ?? `Code ${code}`
}

export async function fetchCapitalForecasts(): Promise<CapitalForecast[]> {
  const params = new URLSearchParams({
    latitude: CAPITALS.map((c) => c.lat).join(','),
    longitude: CAPITALS.map((c) => c.lon).join(','),
    current:
      'temperature_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation',
    daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
    forecast_days: '1',
    timezone: 'auto',
    wind_speed_unit: 'kmh',
  })

  const res = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`, {
    headers: { Accept: 'application/json' },
  })
  if (!res.ok) throw new Error(`Open-Meteo unavailable (${res.status})`)

  const json = (await res.json()) as OpenMeteoPoint | OpenMeteoPoint[]
  const rows = Array.isArray(json) ? json : [json]

  return CAPITALS.map((capital, i) => {
    const row = rows[i]
    const current = row?.current
    const daily = row?.daily
    return {
      id: capital.id,
      name: capital.name,
      lat: capital.lat,
      lon: capital.lon,
      tempC: current?.temperature_2m ?? null,
      feelsLikeC: current?.apparent_temperature ?? null,
      weatherCode: current?.weather_code ?? null,
      windKmh: current?.wind_speed_10m ?? null,
      precipMm: current?.precipitation ?? null,
      precipProb: daily?.precipitation_probability_max?.[0] ?? null,
      maxC: daily?.temperature_2m_max?.[0] ?? null,
      minC: daily?.temperature_2m_min?.[0] ?? null,
    }
  })
}

export function formatTemp(value: number | null): string {
  if (value == null || Number.isNaN(value)) return '—'
  return `${Math.round(value)}°`
}
