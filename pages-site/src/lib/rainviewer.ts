export type RadarFrame = {
  time: number
  path: string
  tileUrl: string
}

type RainViewerMaps = {
  host?: string
  radar?: {
    past?: Array<{ time: number; path: string }>
    nowcast?: Array<{ time: number; path: string }>
  }
  satellite?: {
    infrared?: Array<{ time: number; path: string }>
  }
}

const RAINVIEWER_URL = 'https://api.rainviewer.com/public/weather-maps.json'

/** Universal Blue radar tiles (no server-side recolour on static hosting). */
export function radarTileUrl(host: string, path: string): string {
  const base = `${host.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
  return `${base}/256/{z}/{x}/{y}/2/0_0.png`
}

export function satelliteTileUrl(host: string, path: string): string {
  const base = `${host.replace(/\/$/, '')}${path.startsWith('/') ? path : `/${path}`}`
  return `${base}/256/{z}/{x}/{y}/0/0_0.png`
}

export async function fetchRadarFrames(): Promise<{
  frames: RadarFrame[]
  generated: number
}> {
  const res = await fetch(RAINVIEWER_URL, { cache: 'no-store' })
  if (!res.ok) throw new Error(`RainViewer unavailable (${res.status})`)
  const data = (await res.json()) as RainViewerMaps
  const host = data.host
  if (!host) throw new Error('RainViewer host missing')

  const past = data.radar?.past ?? []
  const frames = past.map((f) => ({
    time: f.time,
    path: f.path,
    tileUrl: radarTileUrl(host, f.path),
  }))

  return { frames, generated: Date.now() }
}

export async function fetchSatelliteIrLatest(): Promise<string | null> {
  const res = await fetch(RAINVIEWER_URL, { cache: 'no-store' })
  if (!res.ok) return null
  const data = (await res.json()) as RainViewerMaps
  const host = data.host
  const frames = data.satellite?.infrared ?? []
  const tip = frames[frames.length - 1]
  if (!host || !tip) return null
  return satelliteTileUrl(host, tip.path)
}

export function formatFrameTime(unixSec: number): string {
  return new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Sydney',
    hour: '2-digit',
    minute: '2-digit',
    day: 'numeric',
    month: 'short',
    hour12: false,
  }).format(new Date(unixSec * 1000))
}
