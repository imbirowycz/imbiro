<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import type { PriceItem, SavePriceItemDTO } from '@myorg/shared'
import { ApiRequestError, pricesApi } from '../api/prices'
import { shortDate } from './format'
import SourceCard from './SourceCard.vue'
import { AUTO_DEFINITION, draftFromSource, newDraft, parseDefinition, type SourceDraft } from './source-draft'
import './prices.css'

const route = useRoute()
const router = useRouter()
const itemId = computed(() => (route.params.id && route.params.id !== 'nowy' ? String(route.params.id) : null))

type Preset = 'three' | 'two' | 'one' | 'interval' | 'custom'
const PRESET_CRON: Record<string, string> = { three: '0 7,12,19 * * *', two: '0 7,19 * * *', one: '0 8 * * *' }

const form = reactive({
  name: '',
  description: '',
  ean: '',
  targetPrice: '' as string | number,
  minDropPct: 5 as number,
  enabled: true,
  preset: 'three' as Preset,
  cron: '0 7,12,19 * * *',
  everyHours: 6,
  jitterMinutes: 60,
  telegram: false,
  telegramChatId: '',
  email: false,
  emailTo: '',
})
const sources = ref<SourceDraft[]>([newDraft()])
const loaded = ref<PriceItem | null>(null)
const loading = ref(false)
const saving = ref(false)
const loadError = ref<string | null>(null)
const errors = ref<Record<string, string>>({})
const formError = ref<string | null>(null)
const notifyMessage = ref<{ text: string; kind: 'ok' | 'error' } | null>(null)
const testingChannel = ref<'telegram' | 'email' | null>(null)

const itemInfo = computed(() => ({ name: form.name, description: form.description, ean: form.ean }))

function fill(item: PriceItem) {
  loaded.value = item
  form.name = item.name
  form.description = item.description ?? ''
  form.ean = item.ean ?? ''
  form.targetPrice = item.targetPrice ?? ''
  form.minDropPct = item.minDropPct
  form.enabled = item.enabled
  form.jitterMinutes = item.schedule.jitterMinutes
  if (item.schedule.kind === 'interval') {
    form.preset = 'interval'
    form.everyHours = item.schedule.everyHours ?? 6
  } else {
    const preset = (Object.entries(PRESET_CRON).find(([, cron]) => cron === item.schedule.cron)?.[0] ?? 'custom') as Preset
    form.preset = preset
    form.cron = item.schedule.cron ?? PRESET_CRON.three
  }
  form.telegram = item.notify.telegram
  form.telegramChatId = item.notify.telegramChatId ?? ''
  form.email = item.notify.email
  form.emailTo = item.notify.emailTo ?? ''
  sources.value = item.sources.length ? item.sources.map(draftFromSource) : [newDraft()]
}

onMounted(async () => {
  if (!itemId.value) return
  loading.value = true
  try {
    fill(await pricesApi.getItem(itemId.value))
  } catch (err) {
    loadError.value = (err as Error).message
  } finally {
    loading.value = false
  }
})

function addSource() {
  sources.value.push(newDraft())
}
function removeSource(index: number) {
  const source = sources.value[index]
  if (source.id && !confirm(`Usunąć źródło „${source.label || source.url}”? Po zapisaniu zniknie razem z historią cen.`)) return
  sources.value.splice(index, 1)
}
function moveSource(index: number, delta: number) {
  const target = index + delta
  if (target < 0 || target >= sources.value.length) return
  const list = [...sources.value]
  ;[list[index], list[target]] = [list[target], list[index]]
  sources.value = list
}

function buildDto(): SavePriceItemDTO | null {
  const local: Record<string, string> = {}
  const dtoSources: SavePriceItemDTO['sources'] = []
  sources.value.forEach((source, index) => {
    // Pusta karta (bez linku i definicji) jest pomijana.
    if (!source.url.trim() && !source.definitionText.trim() && !source.label.trim()) return
    const parsed = parseDefinition(source.definitionText)
    if (parsed.kind === 'invalid') local[`sources.${index}.definition`] = parsed.message
    if (parsed.kind === 'refusal') local[`sources.${index}.definition`] = 'Definicja to odpowiedź z błędem od AI'
    dtoSources.push({
      id: source.id,
      label: source.label.trim() || hostOf(source.url),
      url: source.url.trim(),
      fetchMode: source.fetchMode,
      definition: parsed.kind === 'definition' ? parsed.value : AUTO_DEFINITION,
    })
  })
  if (Object.keys(local).length) {
    errors.value = local
    formError.value = 'Popraw definicje źródeł zaznaczone poniżej.'
    return null
  }
  const schedule: SavePriceItemDTO['schedule'] =
    form.preset === 'interval'
      ? { kind: 'interval', everyHours: Number(form.everyHours), jitterMinutes: Number(form.jitterMinutes) }
      : { kind: 'cron', cron: form.preset === 'custom' ? form.cron.trim() : PRESET_CRON[form.preset], jitterMinutes: Number(form.jitterMinutes) }
  return {
    name: form.name,
    description: form.description || null,
    ean: form.ean || null,
    targetPrice: form.targetPrice === '' ? null : Number(form.targetPrice),
    minDropPct: Number(form.minDropPct),
    enabled: form.enabled,
    notify: {
      telegram: form.telegram,
      telegramChatId: form.telegramChatId.trim() || null,
      email: form.email,
      emailTo: form.emailTo.trim() || null,
    },
    schedule,
    sources: dtoSources,
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return 'Sklep'
  }
}

async function save() {
  errors.value = {}
  formError.value = null
  const dto = buildDto()
  if (!dto) return
  const untested = sources.value.filter((s) => s.url.trim() && !s.id && !s.test?.ok)
  if (untested.length && !confirm(`${untested.length === 1 ? 'Jedno źródło nie zostało' : `${untested.length} źródła nie zostały`} sprawdzone z wynikiem „działa”. Zapisać mimo to?`)) return
  saving.value = true
  try {
    const saved = itemId.value ? await pricesApi.updateItem(itemId.value, dto) : await pricesApi.createItem(dto)
    await router.push({ path: '/ceny' })
    void saved
  } catch (err) {
    if (err instanceof ApiRequestError && err.details.length) {
      errors.value = Object.fromEntries(err.details.map((d) => [d.path, d.message]))
      formError.value = `${err.message}: ${err.details.map((d) => `${d.path} — ${d.message}`).join('; ')}`
    } else {
      formError.value = (err as Error).message
    }
    window.scrollTo({ top: 0, behavior: 'smooth' })
  } finally {
    saving.value = false
  }
}

async function remove() {
  if (!itemId.value || !loaded.value) return
  if (!confirm(`Usunąć „${loaded.value.name}”?\n\nZniknie razem ze wszystkimi źródłami, historią cen, okazjami i harmonogramem.`)) return
  try {
    await pricesApi.deleteItem(itemId.value)
    await router.push('/ceny')
  } catch (err) {
    formError.value = (err as Error).message
  }
}

async function testChannel(channel: 'telegram' | 'email') {
  testingChannel.value = channel
  notifyMessage.value = null
  try {
    if (channel === 'telegram') await pricesApi.testNotification({ channel, telegramChatId: form.telegramChatId.trim() })
    else await pricesApi.testNotification({ channel, emailTo: form.emailTo.trim() })
    notifyMessage.value = { text: channel === 'telegram' ? 'Wysłano wiadomość testową na Telegram.' : 'Wysłano e-mail testowy.', kind: 'ok' }
  } catch (err) {
    const detail = err instanceof ApiRequestError && err.details.length ? `: ${err.details.map((d) => d.message).join(', ')}` : ''
    notifyMessage.value = { text: `${(err as Error).message}${detail}`, kind: 'error' }
  } finally {
    testingChannel.value = null
  }
}

const err = (path: string) => errors.value[path]
</script>

<template>
  <div class="pr-shell">
    <header class="pr-top">
      <div>
        <h1>{{ itemId ? 'Edycja artykułu' : 'Nowy artykuł' }}</h1>
        <p class="pr-lede">Co szukasz, gdzie i jak często sprawdzać</p>
      </div>
      <div class="pr-actions">
        <RouterLink class="button ghost" to="/ceny">Wróć do listy</RouterLink>
      </div>
    </header>

    <p v-if="loading" class="muted">Ładowanie…</p>
    <p v-else-if="loadError" class="pr-error-text">{{ loadError }}</p>

    <form v-else class="item-form" novalidate @submit.prevent="save">
      <p v-if="formError" class="pr-notice error" role="alert">{{ formError }}</p>

      <fieldset class="pr-card">
        <legend>Co szukam</legend>
        <label class="field">
          <span>Nazwa artykułu</span>
          <input v-model="form.name" type="text" maxlength="200" placeholder="np. Bialetti Moka Express 6 tz" required :aria-invalid="!!err('name')" />
          <small v-if="err('name')" class="pr-error-text">{{ err('name') }}</small>
        </label>
        <label class="field">
          <span>Opis / model <em>opcjonalnie — pomaga AI odróżnić warianty</em></span>
          <textarea v-model="form.description" rows="2" maxlength="2000" placeholder="np. aluminiowa, 6 filiżanek, srebrna" />
        </label>
        <div class="row">
          <label class="field">
            <span>EAN <em>opcjonalnie</em></span>
            <input v-model="form.ean" type="text" inputmode="numeric" maxlength="14" :aria-invalid="!!err('ean')" />
            <small v-if="err('ean')" class="pr-error-text">{{ err('ean') }}</small>
          </label>
          <label class="field">
            <span>Cena docelowa (zł) <em>opcjonalnie</em></span>
            <input v-model="form.targetPrice" type="number" min="0" step="0.01" :aria-invalid="!!err('targetPrice')" />
          </label>
          <label class="field">
            <span>Minimalny spadek (%)</span>
            <input v-model.number="form.minDropPct" type="number" min="0" max="90" step="0.5" :aria-invalid="!!err('minDropPct')" />
          </label>
        </div>
      </fieldset>

      <fieldset class="sources-set">
        <legend>Źródła</legend>
        <p class="pr-muted hint">
          Dla każdego sklepu: wklej link do produktu, kliknij „Kopiuj prompt”, wklej go agentowi AI, a jego odpowiedź (JSON) wklej w pole
          „Definicja źródła”. Potem „Sprawdź źródło”. Puste pole definicji = odczyt automatyczny z danych strukturalnych strony.
        </p>
        <SourceCard
          v-for="(source, index) in sources"
          :key="source.key"
          :source="source"
          :index="index"
          :count="sources.length"
          :item="itemInfo"
          :errors="errors"
          @remove="removeSource(index)"
          @move="moveSource(index, $event)"
        />
        <button type="button" class="button add" @click="addSource">+ Dodaj źródło</button>
      </fieldset>

      <fieldset class="pr-card">
        <legend>Harmonogram</legend>
        <div class="row">
          <label class="field">
            <span>Jak często</span>
            <select v-model="form.preset">
              <option value="three">3× dziennie (7:00, 12:00, 19:00)</option>
              <option value="two">2× dziennie (7:00, 19:00)</option>
              <option value="one">1× dziennie (8:00)</option>
              <option value="interval">Co kilka godzin</option>
              <option value="custom">Własne wyrażenie cron</option>
            </select>
          </label>
          <label v-if="form.preset === 'interval'" class="field">
            <span>Co ile godzin</span>
            <input v-model.number="form.everyHours" type="number" min="1" max="168" :aria-invalid="!!err('schedule.everyHours')" />
          </label>
          <label v-if="form.preset === 'custom'" class="field">
            <span>Cron <em>5 pól, czas polski</em></span>
            <input v-model="form.cron" type="text" class="code" placeholder="0 7,12,19 * * *" :aria-invalid="!!(err('schedule.cron') || err('scheduleConfig.expression'))" />
            <small v-if="err('schedule.cron') || err('scheduleConfig.expression')" class="pr-error-text">{{ err('schedule.cron') || err('scheduleConfig.expression') }}</small>
          </label>
          <label class="field">
            <span>Losowe przesunięcie (min) <em>sklepy sprawdzane po kolei w tym oknie</em></span>
            <input v-model.number="form.jitterMinutes" type="number" min="0" max="240" />
          </label>
        </div>
        <label class="pr-check"><input v-model="form.enabled" type="checkbox" /> Aktywny (sprawdzaj według harmonogramu)</label>
        <p v-if="loaded?.nextRunAt && loaded.enabled" class="pr-muted">Następne sprawdzenie: {{ shortDate(loaded.nextRunAt) }}</p>
      </fieldset>

      <fieldset class="pr-card">
        <legend>Powiadomienia</legend>
        <p class="pr-muted">Okazje zawsze pojawiają się w zakładce <RouterLink to="/okazje" class="pr-link">Okazje</RouterLink>. Dodatkowo możesz je dostawać:</p>
        <label class="pr-check"><input v-model="form.telegram" type="checkbox" /> Telegram</label>
        <div v-if="form.telegram" class="channel">
          <label class="field">
            <span>Chat id <em>napisz do bota, a chat id odczytasz np. z @userinfobot</em></span>
            <input v-model="form.telegramChatId" type="text" placeholder="123456789" :aria-invalid="!!err('notify.telegramChatId')" />
            <small v-if="err('notify.telegramChatId')" class="pr-error-text">{{ err('notify.telegramChatId') }}</small>
          </label>
          <button type="button" class="button pr-small-button" :disabled="!form.telegramChatId.trim() || !!testingChannel" @click="testChannel('telegram')">
            {{ testingChannel === 'telegram' ? 'Wysyłam…' : 'Wyślij test' }}
          </button>
        </div>
        <label class="pr-check"><input v-model="form.email" type="checkbox" /> E-mail</label>
        <div v-if="form.email" class="channel">
          <label class="field">
            <span>Adres e-mail</span>
            <input v-model="form.emailTo" type="email" placeholder="ty@example.com" :aria-invalid="!!err('notify.emailTo')" />
            <small v-if="err('notify.emailTo')" class="pr-error-text">{{ err('notify.emailTo') }}</small>
          </label>
          <button type="button" class="button pr-small-button" :disabled="!form.emailTo.trim() || !!testingChannel" @click="testChannel('email')">
            {{ testingChannel === 'email' ? 'Wysyłam…' : 'Wyślij test' }}
          </button>
        </div>
        <p v-if="notifyMessage" class="pr-notice" :class="notifyMessage.kind" role="status">{{ notifyMessage.text }}</p>
      </fieldset>

      <div class="foot">
        <button v-if="itemId" type="button" class="button danger" @click="remove">Usuń artykuł</button>
        <span class="spacer" />
        <RouterLink class="button ghost" to="/ceny">Anuluj</RouterLink>
        <button type="submit" class="button primary" :disabled="saving">{{ saving ? 'Zapisuję…' : 'Zapisz' }}</button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.item-form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
}
fieldset {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  margin: 0;
  min-width: 0;
}
fieldset.pr-card {
  padding-top: 0.6rem;
}
.sources-set {
  padding: 0;
  border: 0;
}
legend {
  padding: 0 0.3rem;
  font-family: var(--font-display);
  font-size: 1.15rem;
  font-weight: 600;
  color: var(--signal);
}
.sources-set legend {
  padding: 0;
  margin-bottom: 0.3rem;
}
.hint {
  margin: 0;
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.9rem;
  min-width: 0;
}
/* Rozciąganie tylko w wierszu — w kolumnie flex-basis działałby jak wysokość pola. */
.row > .field {
  flex: 1 1 12rem;
}
.field > span em {
  font-style: normal;
  color: var(--muted);
  margin-left: 0.35rem;
}
.row {
  display: flex;
  flex-wrap: wrap;
  gap: 0.8rem;
}
.channel {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  gap: 0.6rem;
  padding-left: 1.6rem;
}
.code {
  font-family: var(--font-code);
}
.add {
  align-self: flex-start;
}
.foot {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.6rem;
}
.spacer {
  flex: 1;
}
</style>
