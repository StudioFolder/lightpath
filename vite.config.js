import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [react()],
    server: {
      proxy: {
        '/api/flight-search': {
          target: 'https://fr24api.flightradar24.com',
          changeOrigin: true,
          rewrite: (path) => {
            const url = new URL(path, 'http://localhost')
            const flight = url.searchParams.get('flight')
            const now = new Date()
            const from = new Date(now)
            from.setDate(from.getDate() - 14)
            const isoUtc = (d) => d.toISOString().slice(0, 19)
            const params = new URLSearchParams({
              flights: flight,
              flight_datetime_from: isoUtc(from),
              flight_datetime_to: isoUtc(now),
              sort: 'desc',
              limit: '2',
            })
            return `/api/flight-summary/light?${params}`
          },
          headers: {
            Authorization: `Bearer ${env.FR24_API_TOKEN}`,
            'Accept-Version': 'v1',
          },
        },
        '/api/flight-events': {
          target: 'https://fr24api.flightradar24.com',
          changeOrigin: true,
          rewrite: (path) => {
            const url = new URL(path, 'http://localhost')
            const fr24Id = url.searchParams.get('fr24_id')
            const params = new URLSearchParams({
              flight_ids: fr24Id,
              event_types: 'all',
            })
            return `/api/historic/flight-events/light?${params}`
          },
          headers: {
            Authorization: `Bearer ${env.FR24_API_TOKEN}`,
            'Accept-Version': 'v1',
          },
        },
      },
    },
  }
})
