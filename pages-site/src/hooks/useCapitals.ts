import { useEffect, useState } from 'react'
import {
  fetchCapitalForecasts,
  type CapitalForecast,
} from '../lib/capitals'

const REFRESH_MS = 15 * 60 * 1000

export function useCapitals() {
  const [capitals, setCapitals] = useState<CapitalForecast[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const next = await fetchCapitalForecasts()
        if (cancelled) return
        setCapitals(next)
        setError(null)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Forecasts unavailable')
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

  return { capitals, loading, error }
}
