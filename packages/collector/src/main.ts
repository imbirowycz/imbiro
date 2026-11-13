import { createApi } from './api'
import { createBrowserLoader } from './browser'
import { Collector } from './collector'
import { config } from './config'

// Entry point: wires the collector and stops it cleanly on Ctrl+C / systemd stop.

async function main(): Promise<void> {
  const stop = new AbortController()
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      console.log(`Zbieracz: ${signal}, kończę…`)
      stop.abort()
    })
  }

  const loader = createBrowserLoader({ profileDir: config.profileDir, channel: config.browserChannel, headless: config.headless })
  const collector = new Collector({ api: createApi(config), loader })

  console.log(`Zbieracz ${config.hostname} → ${config.apiUrl} (przeglądarka: ${config.browserChannel}${config.headless ? ', bez okna' : ''})`)
  await collector.run(stop.signal)
  await loader.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
