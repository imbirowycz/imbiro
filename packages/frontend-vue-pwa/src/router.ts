import { createRouter, createWebHistory } from 'vue-router'

// History mode works in production because `serve -s` and the PWA service worker
// fall back to index.html for unknown paths (API paths are excluded in vite.config.ts).
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('./radar/HomePage.vue'), meta: { title: 'Radar' } },
    {
      path: '/weather',
      name: 'weather',
      component: () => import('./radar/WeatherPage.vue'),
      meta: { title: 'Pogoda i finanse' },
    },
    {
      path: '/read',
      name: 'read',
      component: () => import('./radar/ReaderPage.vue'),
      meta: { title: 'Czytanie' },
    },
    {
      path: '/ceny',
      name: 'prices',
      component: () => import('./prices/PricesPage.vue'),
      meta: { title: 'Łowca cen' },
    },
    {
      // Osobny rekord trasy: przejście z edycji do „nowego” montuje formularz od nowa.
      path: '/ceny/nowy',
      name: 'price-new',
      component: () => import('./prices/PriceItemPage.vue'),
      meta: { title: 'Nowy artykuł' },
    },
    {
      path: '/ceny/:id',
      name: 'price-item',
      component: () => import('./prices/PriceItemPage.vue'),
      meta: { title: 'Artykuł' },
    },
    {
      path: '/okazje',
      name: 'offers',
      component: () => import('./prices/OffersPage.vue'),
      meta: { title: 'Okazje' },
    },
    {
      path: '/scheduler/:taskId?',
      name: 'scheduler',
      component: () => import('./components/SchedulerPage.vue'),
      meta: { title: 'Scheduler' },
    },
    { path: '/:pathMatch(.*)*', redirect: '/' },
  ],
  scrollBehavior(to, _from, saved) {
    if (saved) return saved
    // Section anchors on dashboard pages are handled by the page itself (sticky tabs offset).
    if (to.hash) return false
    return { top: 0 }
  },
})

// Old scheduler links used "#/<taskId>" on the root page.
router.beforeEach((to) => {
  const legacy = /^#\/([0-9a-f-]{36})$/i.exec(to.hash)
  if (to.path === '/' && legacy) return { name: 'scheduler', params: { taskId: legacy[1] } }
})

router.afterEach((to) => {
  document.title = to.meta.title ? `${String(to.meta.title)} – imbiro` : 'imbiro'
})
