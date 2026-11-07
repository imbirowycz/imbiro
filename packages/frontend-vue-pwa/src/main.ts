import { createApp } from 'vue'
import { registerSW } from 'virtual:pwa-register'
import App from './App.vue'
import { router } from './router'

createApp(App).use(router).mount('#app')

// After a deploy the open app (especially the installed PWA) would keep running the old version.
// autoUpdate: the new service worker takes over and the page reloads itself onto the new version.
// The app can stay open for days, so also look for a new version every 30 minutes.
const UPDATE_CHECK_MS = 30 * 60_000
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    if (!registration) return
    setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) void registration.update()
    }, UPDATE_CHECK_MS)
  },
})
