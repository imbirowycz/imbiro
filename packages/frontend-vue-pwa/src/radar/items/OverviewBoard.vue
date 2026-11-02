<script setup lang="ts">
import { computed } from 'vue'
import type { AlertItem, CurrencyRate, NewsItem, OverviewBlock, WeatherNow } from '@myorg/shared'
import { change, degrees, number } from '../format'
import AlertList from './AlertList.vue'
import NewsList from './NewsList.vue'

// The one bold element of the dashboard: a departure-board strip with the morning's key numbers,
// in the same visual language as the scheduler's board (large amber numerals, ruled rows).

const props = defineProps<{ blocks: OverviewBlock[] }>()
const block = (key: string) => props.blocks.find((b) => b.key === key)

const weather = computed(() => block('weather')?.items[0] as WeatherNow | undefined)
const eur = computed(() => (block('currencies')?.items as CurrencyRate[] | undefined)?.find((r) => r.code === 'EUR'))
const alerts = computed(() => (block('alerts')?.items ?? []) as AlertItem[])
const air = computed(() => alerts.value.find((a) => a.category === 'air'))
const warnings = computed(() => alerts.value.filter((a) => a.severity !== 'info'))
const otherAlerts = computed(() => alerts.value.filter((a) => a.category !== 'air'))
const airLabel = computed(() => air.value?.title.replace(/^Jakość powietrza:\s*/, '').replace(/\s*\(.*\)$/, '') ?? null)
const newsBlocks = computed(() => props.blocks.filter((b) => b.itemKind === 'news'))
</script>

<template>
  <div class="overview">
    <dl class="board">
      <div class="cell">
        <dt>Teraz w Warszawie</dt>
        <dd class="big">{{ weather ? degrees(weather.temperature) : '–' }}</dd>
        <dd class="sub">{{ weather ? `${weather.description}, odczuwalna ${degrees(weather.apparentTemperature)}` : 'brak danych' }}</dd>
      </div>
      <div class="cell">
        <dt>Euro</dt>
        <dd class="big">{{ eur ? number(eur.mid, 4) : '–' }}</dd>
        <dd class="sub">{{ eur ? `zł, ${change(eur.change, 4)}` : 'brak danych' }}</dd>
      </div>
      <div class="cell">
        <dt>Powietrze</dt>
        <dd class="big word">{{ airLabel ?? '–' }}</dd>
        <dd class="sub">{{ air ? 'najgorsza stacja GIOŚ' : 'brak danych' }}</dd>
      </div>
      <div class="cell" :class="{ alarm: warnings.length }">
        <dt>Ostrzeżenia</dt>
        <dd class="big">{{ warnings.length }}</dd>
        <dd class="sub">{{ warnings.length ? warnings[0].title : 'IMGW nie ostrzega dla Warszawy' }}</dd>
      </div>
    </dl>

    <div class="columns">
      <div v-for="b in newsBlocks" :key="b.key" class="column">
        <NewsList
          v-if="b.status !== 'error'"
          :items="b.items as NewsItem[]"
          :heading="b.title"
          :limit="3"
          :sortable="false"
          :show-summary="false"
        />
        <p v-else class="unavailable">{{ b.title }}: {{ b.error }}</p>
      </div>
    </div>

    <AlertList v-if="otherAlerts.length" :alerts="otherAlerts" :air="[]" heading />
  </div>
</template>

<style scoped>
.board {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  margin: 1rem 0 0;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}
.cell {
  min-width: 0;
  padding: 1rem 1.25rem 1.1rem;
  border-left: 1px solid var(--line);
}
.cell:first-child {
  padding-left: 0;
  border-left: 0;
}
dt {
  color: var(--muted);
  font-size: 0.85rem;
}
dd {
  margin: 0;
}
.big {
  margin-top: 0.35rem;
  color: var(--signal);
  font-family: var(--font-display);
  font-size: clamp(2.2rem, 4.5vw, 3.4rem);
  font-weight: 600;
  line-height: 1;
  font-variant-numeric: tabular-nums;
}
.big.word {
  font-size: clamp(1.6rem, 3vw, 2.3rem);
  line-height: 1.15;
}
.big.word::first-letter {
  text-transform: uppercase;
}
.alarm .big {
  color: var(--fail);
}
.sub {
  margin-top: 0.4rem;
  overflow: hidden;
  color: var(--muted);
  font-size: 0.85rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.columns {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 17rem), 1fr));
  gap: 0 2rem;
}
.unavailable {
  margin: 1rem 0;
  color: var(--fail);
  font-size: 0.9rem;
}
@media (max-width: 52rem) {
  .board {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
  .cell:nth-child(3) {
    padding-left: 0;
    border-left: 0;
  }
  .cell:nth-child(n + 3) {
    border-top: 1px solid var(--line);
  }
}
</style>
