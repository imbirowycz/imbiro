<script setup lang="ts">
import { computed, ref } from 'vue'
import type { PriceShop, SavePriceSourceDTO } from '@myorg/shared'
import { definitionFor, hostOf, searchLink, shopOf } from './format'

// One row for adding a source: pick a known shop (or "own address"), paste the product page.
// Used by the item form and by the item popup.

const props = defineProps<{ shops: PriceShop[]; itemName: string; busy?: boolean }>()
const emit = defineEmits<{ add: [source: SavePriceSourceDTO] }>()

const OWN = 'own'
const shopId = ref<string>(OWN)
const url = ref('')
const label = ref('')
const priceSelector = ref('')
const error = ref<string | null>(null)

const shop = computed(() => props.shops.find((s) => s.id === shopId.value))

function submit() {
  const address = url.value.trim()
  if (!/^https:\/\/\S+\.\S+/.test(address)) {
    error.value = 'Wklej pełny adres strony produktu (https://…)'
    return
  }
  // The pasted address decides the shop name: a link to another known shop is labelled as that shop.
  const name = label.value.trim() || shopOf(address, props.shops)?.label || shop.value?.label || hostOf(address)
  emit('add', { label: name, url: address, enabled: true, definition: definitionFor(priceSelector.value) })
  url.value = ''
  label.value = ''
  priceSelector.value = ''
  error.value = null
}
</script>

<template>
  <div class="adder">
    <div class="row">
      <label class="field shop">
        <span>Źródło</span>
        <select v-model="shopId">
          <option :value="OWN">Własny adres</option>
          <option v-for="s in shops" :key="s.id" :value="s.id">{{ s.label }}</option>
        </select>
      </label>
      <label class="field url">
        <span>Adres strony produktu</span>
        <input v-model="url" type="url" inputmode="url" placeholder="https://…" :aria-invalid="!!error" @keydown.enter.prevent="submit" />
      </label>
      <button type="button" class="button" :disabled="busy" @click="submit">Dodaj źródło</button>
    </div>

    <p v-if="shop && itemName.trim()" class="hint">
      <a :href="searchLink(shop, itemName)" target="_blank" rel="noopener noreferrer">Szukaj „{{ itemName.trim() }}” w {{ shop.label }}</a>
      — otwórz produkt i wklej tu jego adres.
    </p>
    <details v-if="shopId === OWN" class="own">
      <summary>Nazwa i selektor ceny (opcjonalnie)</summary>
      <div class="row">
        <label class="field">
          <span>Nazwa źródła</span>
          <input v-model="label" type="text" maxlength="100" placeholder="domyślnie: domena" />
        </label>
        <label class="field">
          <span>Selektor CSS ceny</span>
          <input v-model="priceSelector" type="text" class="code" placeholder="np. .product-price" />
        </label>
      </div>
      <p class="hint">Selektor jest potrzebny tylko wtedy, gdy cena nie zostanie znaleziona automatycznie.</p>
    </details>
    <p v-if="error" class="error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.adder {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}
.row {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.6rem;
}
.field {
  display: flex;
  flex: 1 1 10rem;
  flex-direction: column;
  gap: 0.3rem;
  min-width: 0;
  font-size: 0.9rem;
}
.field.url {
  flex: 3 1 16rem;
}
.hint {
  margin: 0;
  color: var(--muted);
  font-size: 0.85rem;
}
.hint a {
  color: var(--signal);
}
.own summary {
  color: var(--muted);
  font-size: 0.85rem;
  cursor: pointer;
}
.own .row {
  margin-top: 0.5rem;
}
.code {
  font-family: var(--font-code);
}
.error {
  margin: 0;
  color: var(--fail);
  font-size: 0.85rem;
}
</style>
