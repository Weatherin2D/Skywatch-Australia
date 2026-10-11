import { useEffect, useMemo, useState } from 'react'
import { RadarMap } from './components/RadarMap'
import { useCapitals } from './hooks/useCapitals'
import { useRadarLoop } from './hooks/useRadarLoop'
import {
  formatTemp,
  weatherLabel,
  type CapitalForecast,
} from './lib/capitals'
import { fetchSatelliteIrLatest, formatFrameTime } from './lib/rainviewer'
import './App.css'

const SPEEDS = [
  { id: 'slow', label: 'Slow', ms: 700 },
  { id: 'normal', label: 'Normal', ms: 400 },
  { id: 'fast', label: 'Fast', ms: 220 },
] as const

function App() {
  const [playing, setPlaying] = useState(true)
  const [speedId, setSpeedId] = useState<(typeof SPEEDS)[number]['id']>('normal')
  const [opacity, setOpacity] = useState(0.75)
  const [showSatellite, setShowSatellite] = useState(false)
  const [satelliteUrl, setSatelliteUrl] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>('syd')
  const [panelOpen, setPanelOpen] = useState(true)

  const speedMs = SPEEDS.find((s) => s.id === speedId)?.ms ?? 400
  const { frames, frame, index, setIndex, loading, error } = useRadarLoop(
    playing,
    speedMs,
  )
  const {
    capitals,
    loading: capitalsLoading,
    error: capitalsError,
  } = useCapitals()

  useEffect(() => {
    let cancelled = false
    async function loadSat() {
      const url = await fetchSatelliteIrLatest()
      if (!cancelled) setSatelliteUrl(url)
    }
    void loadSat()
    const id = window.setInterval(() => void loadSat(), 10 * 60 * 1000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [])

  const selected: CapitalForecast | null = useMemo(() => {
    if (!capitals.length) return null
    return capitals.find((c) => c.id === selectedId) ?? capitals[0] ?? null
  }, [capitals, selectedId])

  return (
    <div className="app">
      <div className="map-plane" aria-hidden={false}>
        <RadarMap
          radarTileUrl={frame?.tileUrl ?? null}
          satelliteTileUrl={satelliteUrl}
          showSatellite={showSatellite}
          radarOpacity={opacity}
          capitals={capitals}
          selectedId={selected?.id ?? null}
          onSelectCapital={(id) => {
            setSelectedId(id)
            setPanelOpen(true)
          }}
        />
      </div>

      <header className="brand-bar">
        <div className="brand">
          <p className="brand-mark">StormFront Australia</p>
          <p className="brand-sub">Australian weather</p>
        </div>
        <p className="tagline">
          Live rain radar and capital forecasts — static hosting, no server.
        </p>
      </header>

      <div className="controls" role="toolbar" aria-label="Radar controls">
        <button
          type="button"
          className="ctrl-btn"
          onClick={() => setPlaying((p) => !p)}
          aria-pressed={playing}
        >
          {playing ? 'Pause' : 'Play'}
        </button>
        <label className="ctrl-field">
          <span>Speed</span>
          <select
            value={speedId}
            onChange={(e) =>
              setSpeedId(e.target.value as (typeof SPEEDS)[number]['id'])
            }
          >
            {SPEEDS.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label className="ctrl-field range">
          <span>Opacity</span>
          <input
            type="range"
            min={0.2}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => setOpacity(Number(e.target.value))}
          />
        </label>
        <label className="ctrl-check">
          <input
            type="checkbox"
            checked={showSatellite}
            onChange={(e) => setShowSatellite(e.target.checked)}
          />
          <span>IR satellite</span>
        </label>
      </div>

      <div className="timeline">
        {loading ? (
          <p className="status">Loading radar frames…</p>
        ) : error ? (
          <p className="status error">{error}</p>
        ) : frames.length === 0 ? (
          <p className="status error">No radar frames available</p>
        ) : (
          <>
            <input
              type="range"
              min={0}
              max={Math.max(0, frames.length - 1)}
              value={index}
              onChange={(e) => {
                setPlaying(false)
                setIndex(Number(e.target.value))
              }}
              aria-label="Radar frame"
            />
            <p className="frame-meta">
              {frame ? formatFrameTime(frame.time) : '—'} AEST/AEDT · frame{' '}
              {index + 1}/{frames.length}
            </p>
          </>
        )}
      </div>

      <aside className={`forecast-panel ${panelOpen ? 'open' : 'closed'}`}>
        <button
          type="button"
          className="panel-toggle"
          onClick={() => setPanelOpen((o) => !o)}
          aria-expanded={panelOpen}
        >
          {panelOpen ? 'Hide forecasts' : 'Show forecasts'}
        </button>

        {panelOpen ? (
          <div className="panel-body">
            <h2>Capital cities</h2>
            <p className="panel-note">Open-Meteo · current conditions</p>

            {capitalsLoading ? (
              <p className="status">Loading forecasts…</p>
            ) : capitalsError ? (
              <p className="status error">{capitalsError}</p>
            ) : (
              <ul className="capital-list">
                {capitals.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      className={c.id === selected?.id ? 'active' : undefined}
                      onClick={() => setSelectedId(c.id)}
                    >
                      <span className="c-name">{c.name}</span>
                      <span className="c-temp">{formatTemp(c.tempC)}</span>
                      <span className="c-wx">{weatherLabel(c.weatherCode)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {selected ? (
              <div className="selected-detail">
                <h3>{selected.name}</h3>
                <dl>
                  <div>
                    <dt>Now</dt>
                    <dd>{formatTemp(selected.tempC)}</dd>
                  </div>
                  <div>
                    <dt>Feels</dt>
                    <dd>{formatTemp(selected.feelsLikeC)}</dd>
                  </div>
                  <div>
                    <dt>Today</dt>
                    <dd>
                      {formatTemp(selected.maxC)} / {formatTemp(selected.minC)}
                    </dd>
                  </div>
                  <div>
                    <dt>Rain chance</dt>
                    <dd>
                      {selected.precipProb != null
                        ? `${Math.round(selected.precipProb)}%`
                        : '—'}
                    </dd>
                  </div>
                  <div>
                    <dt>Wind</dt>
                    <dd>
                      {selected.windKmh != null
                        ? `${Math.round(selected.windKmh)} km/h`
                        : '—'}
                    </dd>
                  </div>
                </dl>
              </div>
            ) : null}

            <p className="lite-disclaimer">
              This version provides live radar and capital-city forecasts.
            </p>
          </div>
        ) : null}
      </aside>
    </div>
  )
}

export default App
