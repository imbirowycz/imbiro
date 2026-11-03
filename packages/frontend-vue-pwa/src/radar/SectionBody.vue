<script setup lang="ts">
import { computed } from 'vue'
import type {
  AirQualityStation,
  AlertItem,
  CurrencyRate,
  GoldPrice,
  ModuleResult,
  NewsItem,
  RadarItemKind,
  WeatherDay,
  WeatherNow,
} from '@myorg/shared'
import AlertList from './items/AlertList.vue'
import type { NewsOrder } from './news-order'
import NewsList from './items/NewsList.vue'
import RatesBoard from './items/RatesBoard.vue'
import WeatherPanel from './items/WeatherPanel.vue'

// Renders whatever the section's modules returned, by item kind — sections need no custom code.

const props = withDefaults(defineProps<{ results: ModuleResult[]; order?: NewsOrder }>(), { order: 'latest' })

function itemsOf<T>(kind: RadarItemKind): T[] {
  return props.results.filter((r) => r.itemKind === kind).flatMap((r) => r.data as T[])
}

const weatherNow = computed(() => itemsOf<WeatherNow>('weather-now')[0] ?? null)
const weatherDays = computed(() => itemsOf<WeatherDay>('weather-day'))
const rates = computed(() => itemsOf<CurrencyRate>('currency-rate'))
const gold = computed(() => itemsOf<GoldPrice>('gold-price'))
const alerts = computed(() => itemsOf<AlertItem>('alert'))
const air = computed(() => itemsOf<AirQualityStation>('air-quality'))

/** News split by category, so e.g. IT and security get their own lists inside one section. */
const CATEGORY_LABEL: Record<NewsItem['category'], string> = {
  poland: 'Polska', world: 'Świat', warsaw: 'Warszawa', economy: 'Gospodarka', it: 'IT i technologia', ai: 'IT i technologia', security: 'Bezpieczeństwo', health: 'Zdrowie',
}
const newsGroups = computed(() => {
  const groups = new Map<string, NewsItem[]>()
  for (const item of itemsOf<NewsItem>('news')) {
    const label = CATEGORY_LABEL[item.category]
    groups.set(label, [...(groups.get(label) ?? []), item])
  }
  return [...groups.entries()]
})
// A heading is only needed when the section mixes kinds (finance + economy news) or categories (IT + security).
const showNewsHeadings = computed(() => newsGroups.value.length > 1 || rates.value.length > 0)
</script>

<template>
  <!-- Air quality is shown inside the weather panel (one selected station). -->
  <WeatherPanel v-if="weatherNow || weatherDays.length || air.length" :now="weatherNow" :days="weatherDays" :air="air" />
  <RatesBoard v-if="rates.length || gold.length" :rates="rates" :gold="gold" />
  <AlertList v-if="alerts.length" :alerts="alerts" :air="[]" heading />
  <div v-if="newsGroups.length" class="news-groups" :class="{ split: newsGroups.length > 1 }">
    <NewsList
      v-for="[label, items] in newsGroups"
      :key="label"
      :items="items"
      :heading="showNewsHeadings ? label : undefined"
      :limit="newsGroups.length > 1 ? 6 : 10"
      :order="order"
    />
  </div>
</template>

<style scoped>
.news-groups.split {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 24rem), 1fr));
  gap: 0 2.5rem;
}
</style>
