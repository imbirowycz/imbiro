<script setup lang="ts">
import type { WeatherDay, WeatherNow } from '@myorg/shared'
import { dayName, degrees, hour, number } from '../format'

defineProps<{ now: WeatherNow | null; days: WeatherDay[] }>()
</script>

<template>
  <div class="weather">
    <div v-if="now" class="now">
      <p class="temp">{{ degrees(now.temperature) }}</p>
      <div class="facts">
        <p class="desc">{{ now.description }}</p>
        <dl>
          <div><dt>Odczuwalna</dt><dd>{{ degrees(now.apparentTemperature) }}</dd></div>
          <div><dt>Wiatr</dt><dd>{{ number(now.windSpeed, 0) }} km/h, porywy {{ number(now.windGusts, 0) }}</dd></div>
          <div><dt>Wilgotność</dt><dd>{{ number(now.humidity, 0) }}%</dd></div>
          <div><dt>Pomiar</dt><dd>{{ hour(now.observedAt) }}</dd></div>
        </dl>
      </div>
    </div>

    <div v-if="now?.hours.length" class="hours-wrap">
      <h3>Najbliższe godziny</h3>
      <ol class="hours" tabindex="0" aria-label="Prognoza godzinowa, przewijana poziomo">
        <li v-for="h in now.hours" :key="h.time">
          <span class="h-time">{{ hour(h.time) }}</span>
          <span class="h-temp">{{ degrees(h.temperature) }}</span>
          <span class="h-rain" :class="{ wet: (h.precipitationProbability ?? 0) >= 40 }">
            {{ h.precipitationProbability ?? 0 }}%
          </span>
          <span class="visually-hidden">{{ h.description }}</span>
        </li>
      </ol>
    </div>

    <div v-if="days.length" class="days-wrap">
      <h3>Kolejne dni</h3>
      <ol class="days">
        <li v-for="d in days" :key="d.date">
          <span class="d-name">{{ dayName(d.date) }}</span>
          <span class="d-range">{{ degrees(d.temperatureMin) }} … {{ degrees(d.temperatureMax) }}</span>
          <span class="d-desc">{{ d.description }}</span>
          <span class="d-rain" :class="{ wet: (d.precipitationProbabilityMax ?? 0) >= 40 }">
            opady {{ d.precipitationProbabilityMax ?? 0 }}%
          </span>
        </li>
      </ol>
    </div>
  </div>
</template>

<style scoped>
.weather {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1.1fr);
  gap: 0 2.5rem;
}
.now {
  display: flex;
  align-items: flex-start;
  gap: 1.5rem;
  padding-top: 1rem;
}
.temp {
  margin: 0;
  color: var(--signal);
  font-family: var(--font-display);
  font-size: 4.5rem;
  font-weight: 600;
  line-height: 0.9;
  font-variant-numeric: tabular-nums;
}
.desc {
  margin: 0 0 0.6rem;
  font-size: 1.15rem;
  font-weight: 500;
}
.desc::first-letter {
  text-transform: uppercase;
}
dl {
  display: grid;
  gap: 0.2rem;
  margin: 0;
  font-size: 0.9rem;
}
dl div {
  display: flex;
  gap: 0.5rem;
}
dt {
  min-width: 6rem;
  color: var(--muted);
}
dd {
  margin: 0;
}
h3 {
  margin: 1.25rem 0 0.5rem;
  font-family: var(--font-display);
  font-size: 1.1rem;
  font-weight: 600;
}
.hours-wrap {
  grid-column: 1 / -1;
}
.hours {
  display: flex;
  gap: 0;
  margin: 0;
  padding: 0 0 0.5rem;
  overflow-x: auto;
  list-style: none;
  border-top: 1px solid var(--line);
  border-bottom: 1px solid var(--line);
}
.hours li {
  /* Containing block for the visually-hidden text — otherwise it escapes the scroller's clipping. */
  position: relative;
  display: flex;
  flex: 0 0 4.5rem;
  flex-direction: column;
  align-items: center;
  gap: 0.15rem;
  padding: 0.6rem 0;
  border-right: 1px solid var(--line);
}
.h-time {
  color: var(--muted);
  font-size: 0.8rem;
}
.h-temp {
  font-family: var(--font-display);
  font-size: 1.25rem;
  font-weight: 600;
}
.h-rain,
.d-rain {
  color: var(--muted);
  font-size: 0.8rem;
}
.wet {
  color: #8fc3ff;
}
.days-wrap {
  grid-column: 1 / -1;
}
.days {
  margin: 0;
  padding: 0;
  list-style: none;
}
.days li {
  display: grid;
  grid-template-columns: 4.5rem 7.5rem minmax(0, 1fr) auto;
  align-items: baseline;
  gap: 1rem;
  padding: 0.55rem 0;
  border-bottom: 1px solid var(--line);
}
.d-name {
  font-weight: 600;
}
.d-range {
  font-family: var(--font-display);
  font-size: 1.1rem;
  font-variant-numeric: tabular-nums;
}
.d-desc {
  color: var(--muted);
}
.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
@media (max-width: 40rem) {
  .weather {
    grid-template-columns: minmax(0, 1fr);
  }
  .temp {
    font-size: 3.5rem;
  }
  .days li {
    grid-template-columns: 3.8rem 6.5rem minmax(0, 1fr);
  }
  .d-rain {
    grid-column: 3;
  }
}
</style>
