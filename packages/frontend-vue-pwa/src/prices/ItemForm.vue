<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import type { PriceItem, PriceShop, SavePriceItemDTO, SavePriceSourceDTO } from '@myorg/shared'
import { ApiRequestError, pricesApi } from '../api/prices'
import { hostOf, SCHEDULE_PRESETS, scheduleFromKey, scheduleKey } from './format'
import SourceAdder from './SourceAdder.vue'

// Adding and editing an item, inline on the page (no separate screen).

const props = defineProps<{
  item: PriceItem | null
  shops: PriceShop[]
  /** Chat id used by another item — a convenient default for a new one. */
  defaultChatId: string | null
}>()
const emit = defineEmits<{ saved: [item: PriceItem]; close: [] }>()

const DEFAULT_SCHEDULE = SCHEDULE_PRESETS[0].value
const item = props.item

const form = reactive({
  name: item?.name ?? '',
  targetPrice: item?.targetPrice ?? (null as number | null),
  minDropPct: item?.minDropPct ?? 5,
  schedule: item ? scheduleKey(item.schedule) : DEFAULT_SCHEDULE,
  telegram: item?.notify.telegram ?? false,
  telegramChatId: item?.notify.telegramChatId ?? props.defaultChatId ?? '',
  sources: (item?.sources ?? []).map<SavePriceSourceDTO>((s) => ({ id: s.id, label: s.label, url: s.url, enabled: s.enabled, definition: s.definition })),
})

// A schedule set elsewhere (a custom cron) stays selectable instead of being silently replaced.
const scheduleOptions = computed(() =>
  SCHEDULE_PRESETS.some((preset) => preset.value === form.schedule)
    ? SCHEDULE_PRESETS
    : [...SCHEDULE_PRESETS, { value: form.schedule, label: `własny (${form.schedule.replace(/^cron:/, 'cron ')})` }]
)

const saving = ref(false)
const formError = ref<string | null>(null)
const fieldErrors = ref<Record<string, string>>({})
const testState = ref<{ text: string; ok: boolean } | null>(null)

async function save() {
  saving.value = true
  formError.value = null
  fieldErrors.value = {}
  const dto: SavePriceItemDTO = {
    name: form.name,
    // Fields this form does not show keep their values.
    description: item?.description ?? null,
    ean: item?.ean ?? null,
    enabled: item?.enabled ?? true,
    targetPrice: form.targetPrice || null,
    minDropPct: Number(form.minDropPct) || 0,
    notify: {
      telegram: form.telegram,
      telegramChatId: form.telegramChatId.trim() || null,
      email: item?.notify.email ?? false,
      emailTo: item?.notify.emailTo ?? null,
    },
    schedule: scheduleFromKey(form.schedule, item?.schedule.jitterMinutes ?? 30),
    sources: form.sources,
  }
  try {
    emit('saved', item ? await pricesApi.updateItem(item.id, dto) : await pricesApi.createItem(dto))
  } catch (err) {
    if (err instanceof ApiRequestError && err.details.length) {
      fieldErrors.value = Object.fromEntries(err.details.map((d) => [d.path, d.message]))
      formError.value = err.details.map((d) => d.message).join(' · ')
    } else {
      formError.value = (err as Error).message
    }
  } finally {
    saving.value = false
  }
}

async function sendTest() {
  testState.value = null
  try {
    await pricesApi.testNotification(form.telegramChatId.trim())
    testState.value = { text: 'Wysłano wiadomość testową.', ok: true }
  } catch (err) {
    const details = err instanceof ApiRequestError ? err.details.map((d) => d.message).join(' · ') : ''
    testState.value = { text: details || (err as Error).message, ok: false }
  }
}
</script>

<template>
  <form class="item-form" :aria-label="item ? 'Edycja artykułu' : 'Nowy artykuł'" @submit.prevent="save">
    <h2>{{ item ? 'Edycja artykułu' : 'Nowy artykuł' }}</h2>

    <div class="grid">
      <label class="field wide">
        <span>Nazwa artykułu</span>
        <input v-model="form.name" type="text" maxlength="200" required placeholder="np. Telewizor LG 55QNED80" :aria-invalid="!!fieldErrors.name" />
      </label>
      <label class="field">
        <span>Cena minimalna <em>(powiadom, gdy cena spadnie do tej kwoty)</em></span>
        <input v-model.number="form.targetPrice" type="number" min="0" step="0.01" inputmode="decimal" placeholder="zł, opcjonalnie" :aria-invalid="!!fieldErrors.targetPrice" />
      </label>
      <label class="field">
        <span>Powiadom o spadku ceny od <em>(%)</em></span>
        <input v-model.number="form.minDropPct" type="number" min="0" max="90" step="0.5" inputmode="decimal" />
      </label>
      <label class="field">
        <span>Sprawdzaj</span>
        <select v-model="form.schedule">
          <option v-for="option in scheduleOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
        </select>
      </label>
      <div class="field">
        <label class="check">
          <input v-model="form.telegram" type="checkbox" />
          <span>Powiadomienia na Telegram</span>
        </label>
        <div v-if="form.telegram" class="inline">
          <input v-model="form.telegramChatId" type="text" placeholder="chat id" aria-label="Chat id Telegrama" :aria-invalid="!!fieldErrors['notify.telegramChatId']" />
          <button type="button" class="button ghost" :disabled="!form.telegramChatId.trim()" @click="sendTest">Test</button>
        </div>
        <span v-if="testState" class="test" :class="{ ok: testState.ok }" role="status">{{ testState.text }}</span>
      </div>
    </div>

    <section class="sources" aria-label="Źródła">
      <h3>Źródła <span class="muted">({{ form.sources.length }})</span></h3>
      <ul v-if="form.sources.length" class="source-list">
        <li v-for="(source, index) in form.sources" :key="source.id ?? `new-${index}`">
          <input v-model="source.label" type="text" class="label" maxlength="100" aria-label="Nazwa źródła" />
          <a :href="source.url" target="_blank" rel="noopener noreferrer" class="url" :title="source.url">{{ hostOf(source.url) }}</a>
          <label class="check small">
            <input v-model="source.enabled" type="checkbox" />
            <span>śledź</span>
          </label>
          <button type="button" class="icon-button" :aria-label="`Usuń źródło ${source.label}`" @click="form.sources.splice(index, 1)">✕</button>
        </li>
      </ul>
      <p v-else class="muted empty">Dodaj przynajmniej jedno źródło — stronę produktu w sklepie.</p>
      <SourceAdder :shops="shops" :item-name="form.name" @add="form.sources.push($event)" />
    </section>

    <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>

    <footer class="foot">
      <button type="button" class="button ghost" @click="emit('close')">Anuluj</button>
      <button type="submit" class="button primary" :disabled="saving">{{ saving ? 'Zapisywanie…' : item ? 'Zapisz zmiany' : 'Dodaj artykuł' }}</button>
    </footer>
  </form>
</template>

<style scoped>
.item-form {
  display: flex;
  flex-direction: column;
  gap: 1.1rem;
  padding: 1.25rem;
  border: 1px solid var(--signal);
  border-radius: 14px;
  background: var(--panel);
}
h2,
h3 {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 600;
}
h2 {
  font-size: 1.4rem;
}
h3 {
  font-size: 1.05rem;
  color: var(--signal);
}
.grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.9rem;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  min-width: 0;
  font-size: 0.9rem;
}
.field.wide {
  grid-column: 1 / -1;
}
.field em {
  font-style: normal;
  color: var(--muted);
}
.check {
  display: flex;
  align-items: center;
  gap: 0.55rem;
}
.check input {
  width: 1.1rem;
  height: 1.1rem;
  accent-color: var(--signal);
}
.check.small {
  font-size: 0.85rem;
  color: var(--muted);
}
.inline {
  display: flex;
  gap: 0.5rem;
}
.test {
  color: var(--fail);
  font-size: 0.85rem;
}
.test.ok {
  color: var(--ok);
}
.sources {
  display: flex;
  flex-direction: column;
  gap: 0.7rem;
  padding-top: 1rem;
  border-top: 1px solid var(--line);
}
.source-list {
  display: flex;
  flex-direction: column;
  gap: 0.4rem;
  margin: 0;
  padding: 0;
  list-style: none;
}
.source-list li {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}
.source-list .label {
  flex: 0 1 12rem;
  min-width: 6rem;
}
.source-list .url {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--muted);
  font-size: 0.85rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.empty {
  margin: 0;
}
.form-error {
  margin: 0;
  padding: 0.65rem 0.8rem;
  border-radius: 8px;
  background: rgb(240 119 106 / 0.12);
  color: var(--fail);
}
.foot {
  display: flex;
  justify-content: flex-end;
  gap: 0.6rem;
}
@media (max-width: 40rem) {
  .grid {
    grid-template-columns: minmax(0, 1fr);
  }
}
</style>
