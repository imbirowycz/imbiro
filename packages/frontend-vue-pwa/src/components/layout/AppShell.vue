<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute } from 'vue-router'
import type { AdminUser } from '@myorg/shared'

defineProps<{ user: AdminUser }>()
const emit = defineEmits<{ logout: [] }>()

const COLLAPSED_KEY = 'imbiro.sidebar.collapsed'
const route = useRoute()

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1'
  } catch {
    return false
  }
}

/** Desktop: narrow icon rail. Mobile: the sidebar is a drawer, closed by default. */
const collapsed = ref(readCollapsed())
const drawerOpen = ref(false)
const drawerToggle = ref<HTMLButtonElement | null>(null)

watch(collapsed, (value) => {
  try {
    localStorage.setItem(COLLAPSED_KEY, value ? '1' : '0')
  } catch {
    // Storage unavailable (private mode) — the preference just is not remembered.
  }
})

// Navigating closes the drawer on mobile.
watch(
  () => route.fullPath,
  () => (drawerOpen.value = false)
)

function closeDrawer() {
  if (!drawerOpen.value) return
  drawerOpen.value = false
  drawerToggle.value?.focus()
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape') closeDrawer()
}
onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))

const nav = [
  { to: '/', name: 'home', label: 'Home', icon: 'radar' },
  { to: '/weather', name: 'weather', label: 'Pogoda i finanse', icon: 'weather' },
  { to: '/ceny', name: 'prices', label: 'Łowca cen', icon: 'tag' },
  { to: '/scheduler', name: 'scheduler', label: 'Scheduler', icon: 'clock' },
] as const
// The reader is part of Home (opened from the dashboard).
const isActive = (name: string) =>
  route.name === name || (name === 'home' && route.name === 'read') || (name === 'prices' && (route.name === 'price-item' || route.name === 'price-new'))
</script>

<template>
  <div class="app" :class="{ collapsed, 'drawer-open': drawerOpen }">
    <header class="mobile-bar">
      <button
        ref="drawerToggle"
        type="button"
        class="icon-button menu"
        aria-controls="sidebar"
        :aria-expanded="drawerOpen"
        aria-label="Otwórz menu"
        @click="drawerOpen = true"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
      </button>
      <span class="brand">imbiro</span>
    </header>

    <div v-if="drawerOpen" class="backdrop" aria-hidden="true" @click="closeDrawer" />

    <nav id="sidebar" class="sidebar" aria-label="Główna nawigacja">
      <div class="sidebar-head">
        <span class="brand">imbiro</span>
        <button
          type="button"
          class="icon-button collapse"
          :aria-label="collapsed ? 'Rozwiń menu' : 'Zwiń menu'"
          :aria-expanded="!collapsed"
          @click="collapsed = !collapsed"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true"><path :d="collapsed ? 'M9 6l6 6-6 6' : 'M15 6l-6 6 6 6'" /></svg>
        </button>
        <button type="button" class="icon-button close" aria-label="Zamknij menu" @click="closeDrawer">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
      </div>

      <ul class="links">
        <li v-for="item in nav" :key="item.name">
          <RouterLink
            :to="item.to"
            class="link"
            :class="{ active: isActive(item.name) }"
            :aria-current="isActive(item.name) ? 'page' : undefined"
            :title="collapsed ? item.label : undefined"
          >
            <svg v-if="item.icon === 'radar'" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4.5" /><path d="M12 12l5.5-5.5" />
            </svg>
            <svg v-else-if="item.icon === 'weather'" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="9" cy="9" r="3.5" /><path d="M9 2.5v1.5M2.5 9H4M4.4 4.4l1.1 1.1M13.6 4.4l-1.1 1.1" />
              <path d="M8 19.5h9a3.5 3.5 0 0 0 0-7 5 5 0 0 0-9.6 1.5A2.75 2.75 0 0 0 8 19.5z" />
            </svg>
            <svg v-else-if="item.icon === 'tag'" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M3.5 12.5V4.5a1 1 0 0 1 1-1h8l8 8-9 9-8-8z" /><circle cx="8.5" cy="8.5" r="1.5" />
            </svg>
            <svg v-else viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 2" />
            </svg>
            <span class="label">{{ item.label }}</span>
          </RouterLink>
        </li>
      </ul>

      <div class="account">
        <span class="label user" :title="user.username">{{ user.username }}</span>
        <button type="button" class="link logout" :title="collapsed ? 'Wyloguj' : undefined" @click="emit('logout')">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 5h4v14h-4M10 8l-4 4 4 4M6 12h9" /></svg>
          <span class="label">Wyloguj</span>
        </button>
      </div>
    </nav>

    <main class="content">
      <slot />
    </main>
  </div>
</template>

<style scoped>
.app {
  --sidebar-width: 14rem;
  min-height: 100dvh;
}
.app.collapsed {
  --sidebar-width: 4.25rem;
}

.sidebar {
  position: fixed;
  inset: 0 auto 0 0;
  z-index: 20;
  display: flex;
  flex-direction: column;
  width: var(--sidebar-width);
  padding: 1rem 0.65rem;
  border-right: 1px solid var(--line);
  background: var(--night);
  transition: width 0.18s ease;
}
.sidebar-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  min-height: 2.5rem;
  padding: 0 0.35rem 1rem;
}
.brand {
  font-family: var(--font-display);
  font-size: 1.6rem;
  font-weight: 600;
  line-height: 1;
}
.collapsed .sidebar-head {
  justify-content: center;
}
.collapsed .sidebar-head .brand,
.collapsed .label {
  display: none;
}
.links {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.link {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  width: 100%;
  padding: 0.6rem 0.7rem;
  border: 0;
  border-radius: 8px;
  background: none;
  color: var(--muted);
  font: inherit;
  font-weight: 500;
  text-decoration: none;
  cursor: pointer;
}
.collapsed .link {
  justify-content: center;
  padding-inline: 0;
}
.link:hover {
  color: var(--ink);
  background: var(--panel);
}
/* Same marker as the selected row on the scheduler board. */
.link.active {
  color: var(--ink);
  background: var(--panel);
  box-shadow: inset 3px 0 0 var(--signal);
}
svg {
  flex: none;
  width: 1.3rem;
  height: 1.3rem;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.7;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.account {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  margin-top: auto;
  padding-top: 1rem;
  border-top: 1px solid var(--line);
}
.user {
  padding: 0.3rem 0.7rem;
  overflow: hidden;
  color: var(--muted);
  font-size: 0.85rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.icon-button {
  display: inline-grid;
  place-items: center;
}
.close,
.mobile-bar,
.backdrop {
  display: none;
}

.content {
  min-width: 0;
  margin-left: var(--sidebar-width);
  transition: margin-left 0.18s ease;
}

/* ---- Mobile: drawer ---- */
@media (max-width: 52rem) {
  .app,
  .app.collapsed {
    --sidebar-width: 16rem;
  }
  .mobile-bar {
    position: sticky;
    top: 0;
    z-index: 15;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    height: 3.25rem;
    padding: 0 0.75rem;
    border-bottom: 1px solid var(--line);
    background: var(--night);
  }
  .mobile-bar .brand {
    font-size: 1.35rem;
  }
  .sidebar {
    transform: translateX(-100%);
    transition: transform 0.2s ease;
    visibility: hidden;
  }
  .drawer-open .sidebar {
    transform: none;
    visibility: visible;
  }
  .backdrop {
    position: fixed;
    inset: 0;
    z-index: 19;
    display: block;
    background: rgb(5 10 20 / 0.6);
  }
  .collapse {
    display: none;
  }
  .close {
    display: inline-grid;
  }
  .collapsed .sidebar-head {
    justify-content: space-between;
  }
  .collapsed .sidebar-head .brand,
  .collapsed .label {
    display: inline;
  }
  .collapsed .link {
    justify-content: flex-start;
    padding-inline: 0.7rem;
  }
  .content {
    margin-left: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .sidebar,
  .content {
    transition: none;
  }
}
</style>
