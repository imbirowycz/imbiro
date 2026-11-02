<script setup lang="ts">
import type { CurrencyRate, GoldPrice } from '@myorg/shared'
import { change, dateOnly, number } from '../format'

defineProps<{ rates: CurrencyRate[]; gold: GoldPrice[] }>()

const trend = (value: number | null) => (value === null || value === 0 ? 'flat' : value > 0 ? 'up' : 'down')
</script>

<template>
  <div class="rates">
    <table v-if="rates.length">
      <caption>Średnie kursy NBP, tabela {{ rates[0].tableNo }} z {{ dateOnly(rates[0].effectiveDate) }}</caption>
      <thead>
        <tr><th scope="col">Waluta</th><th scope="col">Kurs (zł)</th><th scope="col">Zmiana</th></tr>
      </thead>
      <tbody>
        <tr v-for="rate in rates" :key="rate.code">
          <th scope="row"><span class="code">{{ rate.code }}</span><span class="name">{{ rate.name }}</span></th>
          <td class="value">{{ number(rate.mid, 4) }}</td>
          <td class="change" :class="trend(rate.change)">{{ change(rate.change, 4) }}</td>
        </tr>
      </tbody>
    </table>

    <table v-if="gold.length">
      <caption>Cena złota NBP z {{ dateOnly(gold[0].date) }}</caption>
      <thead>
        <tr><th scope="col">Kruszec</th><th scope="col">Cena (zł/g)</th><th scope="col">Zmiana</th></tr>
      </thead>
      <tbody>
        <tr v-for="g in gold" :key="g.date">
          <th scope="row"><span class="code">Złoto</span><span class="name">1 g, próba 1000</span></th>
          <td class="value">{{ number(g.pricePerGram, 2) }}</td>
          <td class="change" :class="trend(g.change)">{{ change(g.change, 2) }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.rates {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 20rem), 1fr));
  gap: 0 2.5rem;
  align-items: start;
}
table {
  width: 100%;
  margin-top: 1rem;
  border-collapse: collapse;
}
caption {
  padding-bottom: 0.5rem;
  color: var(--muted);
  font-size: 0.85rem;
  text-align: left;
}
thead th {
  padding: 0 0 0.4rem;
  border-bottom: 1px solid var(--line);
  color: var(--muted);
  font-size: 0.8rem;
  font-weight: 500;
  text-align: right;
}
thead th:first-child {
  text-align: left;
}
tbody th,
td {
  padding: 0.6rem 0;
  border-bottom: 1px solid var(--line);
}
tbody th {
  text-align: left;
  font-weight: 400;
  white-space: nowrap;
}
.code {
  font-family: var(--font-display);
  font-size: 1.15rem;
  font-weight: 600;
}
.name {
  margin-left: 0.6rem;
  overflow: hidden;
  color: var(--muted);
  font-size: 0.85rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.value {
  color: var(--signal);
  font-family: var(--font-display);
  font-size: 1.6rem;
  font-weight: 600;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.change {
  width: 6.5rem;
  font-size: 0.9rem;
  font-variant-numeric: tabular-nums;
  text-align: right;
}
.up {
  color: var(--ok);
}
.down {
  color: var(--fail);
}
.flat {
  color: var(--muted);
}
</style>
