import { ref } from 'vue'

// Which article URLs the reader accepts — the list comes from the server (GET /api/radar/dashboard),
// so the "Read" button is shown only where reader mode can actually work.
const domains = ref<string[]>([])

export function setReaderDomains(list: string[]): void {
  domains.value = list.map((d) => d.toLowerCase())
}

export function canRead(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase()
    return domains.value.some((d) => host === d || host.endsWith(`.${d}`))
  } catch {
    return false
  }
}
