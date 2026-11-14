import { type BrowserContext, chromium } from 'playwright-core'

// Loads pages in a real, visible Chrome with a persistent profile — the only way that got
// through the shops' anti-bot protection from a home connection (test of 2026-11-14).

export interface LoadedPage {
  httpStatus: number | null
  finalUrl: string
  html: string
}

export interface PageLoader {
  load(url: string, options: { waitFor?: string; timeoutMs: number }): Promise<LoadedPage>
  close(): Promise<void>
}

/** Time for prices rendered by JavaScript when the source names no selector to wait for. */
const SETTLE_MS = 4_000

/** Cookie domains of the page's site: www.euro.com.pl → euro.com.pl, .euro.com.pl, api.euro.com.pl… */
export function siteCookiePattern(url: string): RegExp {
  const site = new URL(url).hostname.replace(/^www\./, '')
  return new RegExp(`(^|\\.)${site.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)
}

export function createBrowserLoader(options: { profileDir: string; channel: string; headless: boolean }): PageLoader {
  let context: BrowserContext | null = null

  async function open(): Promise<BrowserContext> {
    if (context) return context
    const opened = await chromium.launchPersistentContext(options.profileDir, {
      channel: options.channel,
      headless: options.headless,
      locale: 'pl-PL',
      timezoneId: 'Europe/Warsaw',
      viewport: null,
      // Without these Chrome announces automation (navigator.webdriver = true, the
      // "controlled by automated software" bar) and euro.com.pl answers 403 (2026-11-14).
      ignoreDefaultArgs: ['--enable-automation'],
      args: ['--disable-blink-features=AutomationControlled'],
    })
    // The window was closed or the browser crashed: start a new one on the next page.
    opened.on('close', () => {
      if (context === opened) context = null
    })
    context = opened
    return opened
  }

  return {
    async load(url, { waitFor, timeoutMs }) {
      const page = await (await open()).newPage()
      try {
        const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
        if (waitFor) {
          // A missing selector is not an error here — the server decides what the page means.
          await page.waitForSelector(waitFor, { timeout: Math.min(timeoutMs, 15_000) }).catch(() => {})
        } else {
          await page.waitForTimeout(SETTLE_MS)
        }
        const httpStatus = response?.status() ?? null
        const html = await page.content()
        // Bot protection (Akamai on euro.com.pl) remembers its verdict in the shop's cookies
        // (_abck): once marked, every later visit with them is refused. Forget them, so the
        // next attempt comes as a new visitor.
        if (httpStatus === 403 || httpStatus === 429) {
          await page.context().clearCookies({ domain: siteCookiePattern(url) }).catch(() => {})
        }
        return { httpStatus, finalUrl: page.url(), html }
      } finally {
        await page.close().catch(() => {})
      }
    },

    async close() {
      await context?.close().catch(() => {})
      context = null
    },
  }
}
