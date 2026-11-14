// The installed app already shows its name ("imbiro") next to the title in the window bar, so the
// suffix is added only in a browser tab, where it tells the tab apart from other sites.
const installed = () =>
  window.matchMedia('(display-mode: standalone), (display-mode: window-controls-overlay), (display-mode: minimal-ui)').matches

export function setPageTitle(page: string | undefined | null): void {
  document.title = !page ? 'imbiro' : installed() ? page : `${page} – imbiro`
}
