import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Resolved at runtime so esbuild doesn't inline the handler into the config bundle.
const HANDLER_URL = new URL('./api/flight-lookup.js', import.meta.url).href

export default defineConfig(({ mode }) => {
  // Expose .env* values to the API handler, which reads process.env like it does on Vercel.
  // Existing process.env values win.
  for (const [key, value] of Object.entries(loadEnv(mode, process.cwd(), ''))) {
    if (!(key in process.env)) process.env[key] = value
  }

  return {
    plugins: [
      react(),
      {
        name: 'flight-lookup-dev',
        configureServer(server) {
          server.middlewares.use('/api/flight-lookup', async (req, res) => {
            // Imported lazily so process.env is populated before the module initialises.
            // Restart the dev server after editing api/flight-lookup.js.
            const { default: handler } = await import(HANDLER_URL)

            // Minimal adapter from Node's IncomingMessage/ServerResponse to the
            // Vercel-style req/res surface the handler uses.
            req.query = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams)
            res.status = (code) => { res.statusCode = code; return res }
            res.json = (body) => {
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify(body))
              return res
            }

            try {
              await handler(req, res)
            } catch (err) {
              server.config.logger.error(`[flight-lookup] ${err.stack ?? err}`)
              if (!res.headersSent) res.status(500).json({ error: 'request_failed' })
              else res.end()
            }
          })
        },
      },
    ],
  }
})
