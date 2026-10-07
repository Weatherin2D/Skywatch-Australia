import { useEffect } from 'react'
import {
  CircleMarker,
  MapContainer,
  TileLayer,
  Tooltip,
  useMap,
} from 'react-leaflet'
import type { CapitalForecast } from '../lib/capitals'
import { formatTemp, weatherLabel } from '../lib/capitals'
import 'leaflet/dist/leaflet.css'

const AU_CENTER: [number, number] = [-25.5, 134.5]
const AU_ZOOM = 4

type Props = {
  radarTileUrl: string | null
  satelliteTileUrl: string | null
  showSatellite: boolean
  radarOpacity: number
  capitals: CapitalForecast[]
  selectedId: string | null
  onSelectCapital: (id: string) => void
}

function InvalidateOnResize() {
  const map = useMap()
  useEffect(() => {
    const onResize = () => map.invalidateSize()
    window.addEventListener('resize', onResize)
    const t = window.setTimeout(onResize, 80)
    return () => {
      window.removeEventListener('resize', onResize)
      window.clearTimeout(t)
    }
  }, [map])
  return null
}

export function RadarMap({
  radarTileUrl,
  satelliteTileUrl,
  showSatellite,
  radarOpacity,
  capitals,
  selectedId,
  onSelectCapital,
}: Props) {
  return (
    <MapContainer
      center={AU_CENTER}
      zoom={AU_ZOOM}
      minZoom={3}
      maxZoom={10}
      className="radar-map"
      zoomControl={false}
      attributionControl={true}
    >
      <InvalidateOnResize />
      <TileLayer
        url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>'
        subdomains="abcd"
        maxZoom={18}
      />
      {showSatellite && satelliteTileUrl ? (
        <TileLayer
          key={satelliteTileUrl}
          url={satelliteTileUrl}
          opacity={0.55}
          maxNativeZoom={7}
          maxZoom={10}
          attribution="IR © RainViewer"
        />
      ) : null}
      {radarTileUrl ? (
        <TileLayer
          key={radarTileUrl}
          url={radarTileUrl}
          opacity={radarOpacity}
          maxNativeZoom={7}
          maxZoom={10}
          className="radar-tiles"
          attribution="Radar © RainViewer"
        />
      ) : null}
      {capitals.map((c) => {
        const active = c.id === selectedId
        return (
          <CircleMarker
            key={c.id}
            center={[c.lat, c.lon]}
            radius={active ? 9 : 6}
            pathOptions={{
              color: active ? '#0b4f6c' : '#1a6b8a',
              weight: 2,
              fillColor: active ? '#f4a261' : '#e9f5f8',
              fillOpacity: 0.95,
            }}
            eventHandlers={{
              click: () => onSelectCapital(c.id),
            }}
          >
            <Tooltip direction="top" offset={[0, -6]} opacity={1}>
              <strong>{c.name}</strong>
              <br />
              {formatTemp(c.tempC)} · {weatherLabel(c.weatherCode)}
            </Tooltip>
          </CircleMarker>
        )
      })}
    </MapContainer>
  )
}
