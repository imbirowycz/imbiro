// Recognizing anti-bot pages (instead of a product page).

const BLOCK_MARKERS: RegExp[] = [
  /cf-browser-verification|challenge-platform|cf_chl_|Just a moment\.\.\.|Attention Required! \| Cloudflare/i,
  /_Incapsula_Resource|Incapsula incident/i,
  /Access Denied[\s\S]{0,200}Reference #/i,
  /perimeterx|px-captcha|_pxCaptcha/i,
  /datadome|geo\.captcha-delivery\.com/i,
  /g-recaptcha|hcaptcha\.com|captcha-container/i,
  /Pardon Our Interruption/i,
]

/** True when the response looks like an anti-bot block (not a product page). */
export function looksBlocked(status: number, html: string): boolean {
  if (status === 403 || status === 429 || status === 503) return true
  // Amazon and the like: 202 with a short verification page instead of content.
  if (status === 202 && html.length < 20_000) return true
  // A real product page is usually large; block pages are short and carry telltale markers.
  const sample = html.length > 400_000 ? html.slice(0, 400_000) : html
  return BLOCK_MARKERS.some((re) => re.test(sample)) && html.length < 200_000
}

/** A redirect to a captcha page (e.g. ceneo.pl/Captcha/Add) is a block, not a product page. */
export function isCaptchaUrl(url: string | null): boolean {
  if (!url) return false
  try {
    return /captcha|challenge|\/blocked|access-denied/i.test(new URL(url).pathname)
  } catch {
    return false
  }
}
