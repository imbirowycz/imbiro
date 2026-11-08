// Dołączany do service workera (workbox importScripts): kliknięcie powiadomienia o okazji
// otwiera aplikację na zakładce Okazje (albo przełącza istniejące okno).
self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = (event.notification.data && event.notification.data.url) || '/okazje'
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.navigate?.(target)
          return client.focus()
        }
      }
      return self.clients.openWindow(target)
    })
  )
})
