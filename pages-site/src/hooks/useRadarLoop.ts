import { useEffect, useRef, useState } from 'react'
import { fetchRadarFrames, type RadarFrame } from '../lib/rainviewer'

const REFRESH_MS = 5 * 60 * 1000

export function useRadarLoop(playing: boolean, speedMs: number) {
  const [frames, setFrames] = useState<RadarFrame[]>([])
  const [index, setIndex] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const indexRef = useRef(0)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const { frames: next } = await fetchRadarFrames()
        if (cancelled) return
        setFrames(next)
        setError(null)
        const tip = Math.max(0, next.length - 1)
        setIndex(tip)
        indexRef.current = tip
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Radar unavailable')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    const refresh = window.setInterval(() => void load(), REFRESH_MS)
    return () => {
      cancelled = true
      window.clearInterval(refresh)
    }
  }, [])

  useEffect(() => {
    if (!playing || frames.length < 2) return
    const id = window.setInterval(() => {
      const next = (indexRef.current + 1) % frames.length
      indexRef.current = next
      setIndex(next)
    }, speedMs)
    return () => window.clearInterval(id)
  }, [playing, frames.length, speedMs])

  const frame = frames[index] ?? null

  return {
    frames,
    frame,
    index,
    setIndex: (i: number) => {
      indexRef.current = i
      setIndex(i)
    },
    loading,
    error,
  }
}
