<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import type { ApiErrorDetail, CreateScheduledTaskDTO, RadarGroupInfo, RadarModuleInfo, ScheduledTask, ScheduleType } from '@myorg/shared'
import { radarApi } from '../api/radar'
import { ApiRequestError, schedulerApi, type ActionInfo } from '../api/scheduler'
import { actionLabel } from '../lib/format'

const props = defineProps<{ task: ScheduledTask | null; actions: ActionInfo[] }>()
const emit = defineEmits<{ saved: [task: ScheduledTask]; close: [] }>()

type IntervalUnit = 'minutes' | 'hours' | 'days'
type RadarTargetKind = 'group' | 'module' | 'modules'
const UNIT_SECONDS: Record<IntervalUnit, number> = { minutes: 60, hours: 3600, days: 86_400 }
const browserTimeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
const timeZones = Intl.supportedValuesOf('timeZone')

/** Targets of db.cleanup — each has a fixed rule on the server; here only the choice. */
const CLEANUP_TARGETS = [
  { value: 'radar_read_items', label: 'Radar: wygasłe oznaczenia „przeczytane”', hint: 'newsy po 14 dniach, alerty po końcu ważności' },
  { value: 'admin_sessions', label: 'Wygasłe sesje logowania', hint: 'po terminie albo bezczynne' },
  { value: 'login_attempts', label: 'Stare próby logowania', hint: 'starsze niż 1 dzień' },
  { value: 'task_executions', label: 'Historia wykonań zadań', hint: 'zakończone, starsze niż wybrana liczba dni' },
  { value: 'price_observations', label: 'Okazje: stare pomiary cen', hint: 'nieudane po 30 dniach, udane po roku' },
]

interface FormState {
  title: string
  description: string
  enabled: boolean
  actionType: string
  emailTo: string
  emailSubject: string
  emailText: string
  telegramChatId: string
  telegramText: string
  reportPeriodHours: number
  radarTargetKind: RadarTargetKind
  radarGroupId: string
  radarModuleId: string
  radarModuleIds: string[]
  radarChannel: 'telegram' | 'email'
  radarChatId: string
  radarEmailTo: string
  radarEmailSubject: string
  radarMaxItems: number
  cleanupTargets: string[]
  cleanupExecutionsDays: number
  rawConfig: string
  scheduleType: ScheduleType
  cronExpression: string
  intervalValue: number
  intervalUnit: IntervalUnit
  startAt: string
  endAt: string
  timezone: string
}

const dialog = ref<HTMLDialogElement | null>(null)
const saving = ref(false)
const formError = ref<string | null>(null)
const errors = ref<ApiErrorDetail[]>([])
const isEdit = computed(() => props.task !== null)

const form = ref<FormState>(fromTask(props.task))

// Radar catalog for the radar.deliver action (modules and groups available in the backend).
const radarModules = ref<RadarModuleInfo[]>([])
const radarGroups = ref<RadarGroupInfo[]>([])
const radarCatalogError = ref<string | null>(null)
const radarModulesByGroup = computed(() => {
  const groups = new Map<string, RadarModuleInfo[]>()
  for (const module of radarModules.value) groups.set(module.group, [...(groups.get(module.group) ?? []), module])
  return [...groups.entries()]
})

async function loadRadarCatalog() {
  try {
    const [modules, groups] = await Promise.all([radarApi.listModules(), radarApi.listGroups()])
    radarModules.value = modules
    radarGroups.value = groups
    // Sensible defaults for a new radar task.
    form.value.radarGroupId ||= groups[0]?.id ?? ''
    form.value.radarModuleId ||= modules[0]?.id ?? ''
  } catch (err) {
    radarCatalogError.value = (err as Error).message
  }
}
// Stan początkowy — edycja wysyła tylko pola, które się zmieniły.
const initial = props.task ? buildDto(fromTask(props.task)) : null

onMounted(() => {
  dialog.value?.showModal()
  void loadRadarCatalog()
})

function toLocalInput(iso: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function fromTask(task: ScheduledTask | null): FormState {
  const action = (task?.actionConfig ?? {}) as Record<string, unknown>
  const radarTarget = (action.target ?? {}) as { kind?: RadarTargetKind; id?: string; ids?: string[] }
  const radarChannel = (action.channel ?? {}) as { type?: 'telegram' | 'email'; chatId?: unknown; to?: unknown; subject?: string }
  const schedule = (task?.scheduleConfig ?? {}) as { expression?: string; everySeconds?: number }
  const every = schedule.everySeconds ?? 1800
  const unit: IntervalUnit = every % 86_400 === 0 ? 'days' : every % 3600 === 0 ? 'hours' : 'minutes'
  return {
    title: task?.title ?? '',
    description: task?.description ?? '',
    enabled: task?.enabled ?? true,
    actionType: task?.actionType ?? 'report.generate',
    emailTo: Array.isArray(action.to) ? action.to.join(', ') : '',
    emailSubject: String(action.subject ?? ''),
    emailText: String(action.text ?? ''),
    telegramChatId: action.chatId === undefined ? '' : String(action.chatId),
    telegramText: String(action.text ?? ''),
    reportPeriodHours: Number(action.periodHours ?? 24),
    radarTargetKind: radarTarget.kind ?? 'group',
    radarGroupId: radarTarget.kind === 'group' ? (radarTarget.id ?? '') : '',
    radarModuleId: radarTarget.kind === 'module' ? (radarTarget.id ?? '') : '',
    radarModuleIds: radarTarget.kind === 'modules' ? [...(radarTarget.ids ?? [])] : [],
    radarChannel: radarChannel.type ?? 'telegram',
    radarChatId: radarChannel.chatId === undefined ? '' : String(radarChannel.chatId),
    radarEmailTo: Array.isArray(radarChannel.to) ? radarChannel.to.join(', ') : String(radarChannel.to ?? ''),
    radarEmailSubject: radarChannel.subject ?? '',
    radarMaxItems: Number(action.maxItemsPerModule ?? 5),
    cleanupTargets: Array.isArray(action.targets) ? (action.targets as string[]) : CLEANUP_TARGETS.map((t) => t.value),
    cleanupExecutionsDays: Number(action.executionsOlderThanDays ?? 90),
    rawConfig: JSON.stringify(task?.actionConfig ?? {}, null, 2),
    scheduleType: task?.scheduleType ?? 'interval',
    cronExpression: schedule.expression ?? '0 8 * * *',
    intervalValue: every / UNIT_SECONDS[unit],
    intervalUnit: unit,
    startAt: toLocalInput(task?.startAt ?? null),
    endAt: toLocalInput(task?.endAt ?? null),
    // Strefa ma znaczenie tylko dla cron; przy przejściu na cron podpowiadamy strefę przeglądarki.
    timezone: task?.scheduleType === 'cron' ? task.timezone : browserTimeZone,
  }
}

function buildActionConfig(state: FormState): Record<string, unknown> {
  switch (state.actionType) {
    case 'email.send':
      return {
        to: state.emailTo.split(',').map((s) => s.trim()).filter(Boolean),
        subject: state.emailSubject,
        text: state.emailText,
      }
    case 'telegram.send':
      return { chatId: state.telegramChatId.trim(), text: state.telegramText }
    case 'report.generate':
      return { periodHours: Number(state.reportPeriodHours) }
    case 'db.cleanup':
      return {
        // Keep the backend's order, whatever order the boxes were ticked in.
        targets: CLEANUP_TARGETS.map((t) => t.value).filter((v) => state.cleanupTargets.includes(v)),
        executionsOlderThanDays: Number(state.cleanupExecutionsDays),
      }
    case 'radar.deliver':
      return {
        target:
          state.radarTargetKind === 'group'
            ? { kind: 'group', id: state.radarGroupId }
            : state.radarTargetKind === 'module'
              ? { kind: 'module', id: state.radarModuleId }
              : { kind: 'modules', ids: state.radarModuleIds },
        channel:
          state.radarChannel === 'telegram'
            ? { type: 'telegram', chatId: state.radarChatId.trim() }
            : {
                type: 'email',
                to: state.radarEmailTo.split(',').map((s) => s.trim()).filter(Boolean),
                subject: state.radarEmailSubject,
              },
        maxItemsPerModule: Number(state.radarMaxItems),
      }
    default:
      try {
        return JSON.parse(state.rawConfig || '{}')
      } catch {
        throw new Error('Konfiguracja akcji nie jest poprawnym JSON-em')
      }
  }
}

function buildDto(state: FormState): CreateScheduledTaskDTO {
  const scheduleConfig =
    state.scheduleType === 'cron'
      ? { expression: state.cronExpression.trim() }
      : state.scheduleType === 'interval'
        ? { everySeconds: Math.round(Number(state.intervalValue) * UNIT_SECONDS[state.intervalUnit]) }
        : {}
  return {
    title: state.title,
    description: state.description || null,
    enabled: state.enabled,
    actionType: state.actionType,
    actionConfig: buildActionConfig(state),
    scheduleType: state.scheduleType,
    scheduleConfig: scheduleConfig as CreateScheduledTaskDTO['scheduleConfig'],
    // Pola datetime-local są w czasie lokalnym przeglądarki.
    startAt: state.startAt ? new Date(state.startAt).toISOString() : undefined,
    endAt: state.endAt ? new Date(state.endAt).toISOString() : null,
    timezone: state.scheduleType === 'cron' ? state.timezone : (props.task?.timezone ?? 'UTC'),
  }
}

function changedFields(dto: CreateScheduledTaskDTO): Partial<CreateScheduledTaskDTO> {
  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(dto)) {
    const before = (initial as Record<string, unknown> | null)?.[key]
    if (JSON.stringify(value) !== JSON.stringify(before)) patch[key] = value
  }
  // Nie da się usunąć startAt; puste pole w edycji = bez zmiany.
  if (patch.startAt === undefined) delete patch.startAt
  // Zmiana typu harmonogramu/akcji wymaga przesłania nowej konfiguracji.
  if ('scheduleType' in patch) patch.scheduleConfig = dto.scheduleConfig
  if ('actionType' in patch) patch.actionConfig = dto.actionConfig
  return patch
}

async function submit() {
  saving.value = true
  formError.value = null
  errors.value = []
  try {
    const dto = buildDto(form.value)
    let saved: ScheduledTask
    if (props.task) {
      const patch = changedFields(dto)
      saved = Object.keys(patch).length ? await schedulerApi.updateTask(props.task.id, patch) : props.task
    } else {
      saved = await schedulerApi.createTask(dto)
    }
    emit('saved', saved)
  } catch (err) {
    if (err instanceof ApiRequestError) {
      errors.value = err.details
      formError.value = err.details.length ? 'Popraw zaznaczone pola.' : err.message
    } else {
      formError.value = (err as Error).message
    }
  } finally {
    saving.value = false
  }
}

function fieldError(...paths: string[]): string | undefined {
  return errors.value.find((e) => paths.some((p) => e.path === p || e.path.startsWith(`${p}.`)))?.message
}

const knownPaths = [
  'title', 'description', 'enabled', 'actionType', 'actionConfig', 'scheduleType',
  'scheduleConfig', 'startAt', 'endAt', 'timezone',
]
const otherErrors = computed(() => errors.value.filter((e) => !knownPaths.some((p) => e.path === p || e.path.startsWith(`${p}.`))))

const scheduleTypes: { value: ScheduleType; label: string }[] = [
  { value: 'once', label: 'Raz' },
  { value: 'interval', label: 'Co pewien czas' },
  { value: 'cron', label: 'Cron' },
]
const knownActionForms = ['email.send', 'telegram.send', 'report.generate', 'radar.deliver', 'db.cleanup']

const radarTargetKinds: { value: RadarTargetKind; label: string }[] = [
  { value: 'group', label: 'Grupa' },
  { value: 'module', label: 'Moduł' },
  { value: 'modules', label: 'Wybrane moduły' },
]
</script>

<template>
  <dialog ref="dialog" class="sheet" aria-labelledby="task-form-title" @close="emit('close')" @cancel.prevent="emit('close')">
    <form class="form" novalidate @submit.prevent="submit">
      <header class="sheet-head">
        <h2 id="task-form-title">{{ isEdit ? 'Edytuj zadanie' : 'Nowe zadanie' }}</h2>
        <button type="button" class="icon-button" aria-label="Zamknij" @click="emit('close')">✕</button>
      </header>

      <p v-if="formError" class="form-error" role="alert">{{ formError }}</p>
      <ul v-if="otherErrors.length" class="form-error-list">
        <li v-for="e in otherErrors" :key="e.path">{{ e.path }}: {{ e.message }}</li>
      </ul>

      <fieldset>
        <legend>Zadanie</legend>
        <label class="field">
          <span>Nazwa</span>
          <input v-model="form.title" type="text" maxlength="200" required autofocus :aria-invalid="!!fieldError('title')" />
          <small v-if="fieldError('title')" class="error">{{ fieldError('title') }}</small>
        </label>
        <label class="field">
          <span>Opis <em>opcjonalnie</em></span>
          <textarea v-model="form.description" rows="2" maxlength="2000" />
        </label>
      </fieldset>

      <fieldset>
        <legend>Co zrobić</legend>
        <label class="field">
          <span>Akcja</span>
          <select v-model="form.actionType" :aria-invalid="!!fieldError('actionType')">
            <option v-for="a in actions" :key="a.type" :value="a.type">{{ actionLabel(a.type) }}: {{ a.description }}</option>
          </select>
          <small v-if="fieldError('actionType')" class="error">{{ fieldError('actionType') }}</small>
        </label>

        <template v-if="form.actionType === 'email.send'">
          <label class="field">
            <span>Do <em>adresy oddzielone przecinkami</em></span>
            <input v-model="form.emailTo" type="text" inputmode="email" autocomplete="off" :aria-invalid="!!fieldError('actionConfig.to')" />
            <small v-if="fieldError('actionConfig.to')" class="error">{{ fieldError('actionConfig.to') }}</small>
          </label>
          <label class="field">
            <span>Temat</span>
            <input v-model="form.emailSubject" type="text" :aria-invalid="!!fieldError('actionConfig.subject')" />
            <small v-if="fieldError('actionConfig.subject')" class="error">{{ fieldError('actionConfig.subject') }}</small>
          </label>
          <label class="field">
            <span>Treść</span>
            <textarea v-model="form.emailText" rows="4" :aria-invalid="!!fieldError('actionConfig.text')" />
            <small v-if="fieldError('actionConfig.text')" class="error">{{ fieldError('actionConfig.text') }}</small>
          </label>
        </template>

        <template v-else-if="form.actionType === 'telegram.send'">
          <label class="field">
            <span>Czat <em>id liczbowe albo @kanal</em></span>
            <input v-model="form.telegramChatId" type="text" autocomplete="off" :aria-invalid="!!fieldError('actionConfig.chatId')" />
            <small v-if="fieldError('actionConfig.chatId')" class="error">{{ fieldError('actionConfig.chatId') }}</small>
          </label>
          <label class="field">
            <span>Wiadomość</span>
            <textarea v-model="form.telegramText" rows="4" maxlength="4096" :aria-invalid="!!fieldError('actionConfig.text')" />
            <small v-if="fieldError('actionConfig.text')" class="error">{{ fieldError('actionConfig.text') }}</small>
          </label>
        </template>

        <label v-else-if="form.actionType === 'report.generate'" class="field">
          <span>Okres raportu <em>w godzinach wstecz</em></span>
          <input v-model.number="form.reportPeriodHours" type="number" min="1" max="720" :aria-invalid="!!fieldError('actionConfig.periodHours')" />
          <small v-if="fieldError('actionConfig.periodHours')" class="error">{{ fieldError('actionConfig.periodHours') }}</small>
        </label>

        <template v-else-if="form.actionType === 'radar.deliver'">
          <p v-if="radarCatalogError" class="form-error">Nie udało się pobrać listy modułów: {{ radarCatalogError }}</p>

          <div class="segmented" role="radiogroup" aria-label="Co uruchomić">
            <label v-for="k in radarTargetKinds" :key="k.value" :class="{ active: form.radarTargetKind === k.value }">
              <input v-model="form.radarTargetKind" type="radio" name="radarTargetKind" :value="k.value" />
              {{ k.label }}
            </label>
          </div>

          <label v-if="form.radarTargetKind === 'group'" class="field">
            <span>Grupa modułów</span>
            <select v-model="form.radarGroupId" :aria-invalid="!!fieldError('actionConfig.target')">
              <option v-for="g in radarGroups" :key="g.id" :value="g.id">{{ g.name }} ({{ g.moduleIds.length }})</option>
            </select>
            <small v-if="fieldError('actionConfig.target')" class="error">{{ fieldError('actionConfig.target') }}</small>
          </label>

          <label v-else-if="form.radarTargetKind === 'module'" class="field">
            <span>Który moduł</span>
            <select v-model="form.radarModuleId" :aria-invalid="!!fieldError('actionConfig.target')">
              <optgroup v-for="[group, modules] in radarModulesByGroup" :key="group" :label="group">
                <option v-for="m in modules" :key="m.id" :value="m.id">{{ m.name }}</option>
              </optgroup>
            </select>
            <small v-if="fieldError('actionConfig.target')" class="error">{{ fieldError('actionConfig.target') }}</small>
          </label>

          <fieldset v-else class="field checklist" :aria-invalid="!!fieldError('actionConfig.target')">
            <span>Moduły</span>
            <label v-for="m in radarModules" :key="m.id" class="check">
              <input v-model="form.radarModuleIds" type="checkbox" :value="m.id" />
              {{ m.name }} <em class="muted">{{ m.id }}</em>
            </label>
            <small v-if="fieldError('actionConfig.target')" class="error">{{ fieldError('actionConfig.target') }}</small>
          </fieldset>

          <div class="pair">
            <label class="field">
              <span>Wyślij przez</span>
              <select v-model="form.radarChannel">
                <option value="telegram">Telegram</option>
                <option value="email">E-mail</option>
              </select>
            </label>
            <label class="field">
              <span>Pozycji na moduł</span>
              <input v-model.number="form.radarMaxItems" type="number" min="1" max="20" :aria-invalid="!!fieldError('actionConfig.maxItemsPerModule')" />
              <small v-if="fieldError('actionConfig.maxItemsPerModule')" class="error">{{ fieldError('actionConfig.maxItemsPerModule') }}</small>
            </label>
          </div>

          <label v-if="form.radarChannel === 'telegram'" class="field">
            <span>Czat <em>id liczbowe albo @kanal</em></span>
            <input v-model="form.radarChatId" type="text" autocomplete="off" :aria-invalid="!!fieldError('actionConfig.channel')" />
            <small v-if="fieldError('actionConfig.channel')" class="error">{{ fieldError('actionConfig.channel') }}</small>
          </label>
          <template v-else>
            <label class="field">
              <span>Do <em>adresy oddzielone przecinkami</em></span>
              <input v-model="form.radarEmailTo" type="text" inputmode="email" autocomplete="off" :aria-invalid="!!fieldError('actionConfig.channel.to')" />
              <small v-if="fieldError('actionConfig.channel.to')" class="error">{{ fieldError('actionConfig.channel.to') }}</small>
            </label>
            <label class="field">
              <span>Temat</span>
              <input v-model="form.radarEmailSubject" type="text" :aria-invalid="!!fieldError('actionConfig.channel.subject')" />
              <small v-if="fieldError('actionConfig.channel.subject')" class="error">{{ fieldError('actionConfig.channel.subject') }}</small>
            </label>
          </template>
          <small class="hint">Tytuł wiadomości to nazwa zadania. Dane są pobierane w chwili wykonania i nie są zapisywane.</small>
        </template>

        <template v-else-if="form.actionType === 'db.cleanup'">
          <fieldset class="field checklist">
            <span>Co czyścić</span>
            <label v-for="t in CLEANUP_TARGETS" :key="t.value" class="check">
              <input v-model="form.cleanupTargets" type="checkbox" :value="t.value" />
              {{ t.label }} <em class="muted">{{ t.hint }}</em>
            </label>
            <small v-if="fieldError('actionConfig.targets')" class="error">{{ fieldError('actionConfig.targets') }}</small>
          </fieldset>
          <label v-if="form.cleanupTargets.includes('task_executions')" class="field">
            <span>Historia wykonań starsza niż <em>dni, 7–3650</em></span>
            <input
              v-model.number="form.cleanupExecutionsDays"
              type="number"
              min="7"
              max="3650"
              :aria-invalid="!!fieldError('actionConfig.executionsOlderThanDays')"
            />
            <small v-if="fieldError('actionConfig.executionsOlderThanDays')" class="error">{{
              fieldError('actionConfig.executionsOlderThanDays')
            }}</small>
          </label>
          <small class="hint">Usuwane są tylko dane, których aplikacja już nie potrzebuje. Wynik (ile usunięto) widać w historii wykonań.</small>
        </template>

        <label v-if="!knownActionForms.includes(form.actionType)" class="field">
          <span>Konfiguracja <em>JSON</em></span>
          <textarea v-model="form.rawConfig" rows="5" spellcheck="false" class="code" :aria-invalid="!!fieldError('actionConfig')" />
          <small v-if="fieldError('actionConfig')" class="error">{{ fieldError('actionConfig') }}</small>
        </label>
      </fieldset>

      <fieldset>
        <legend>Kiedy</legend>
        <div class="segmented" role="radiogroup" aria-label="Rodzaj harmonogramu">
          <label v-for="t in scheduleTypes" :key="t.value" :class="{ active: form.scheduleType === t.value }">
            <input v-model="form.scheduleType" type="radio" name="scheduleType" :value="t.value" />
            {{ t.label }}
          </label>
        </div>

        <label v-if="form.scheduleType === 'once'" class="field">
          <span>Termin</span>
          <input v-model="form.startAt" type="datetime-local" :aria-invalid="!!fieldError('startAt')" />
          <small v-if="fieldError('startAt')" class="error">{{ fieldError('startAt') }}</small>
        </label>

        <template v-if="form.scheduleType === 'interval'">
          <div class="field">
            <span id="interval-label">Powtarzaj co</span>
            <div class="inline" role="group" aria-labelledby="interval-label">
              <input v-model.number="form.intervalValue" type="number" min="1" aria-label="Liczba" :aria-invalid="!!fieldError('scheduleConfig')" />
              <select v-model="form.intervalUnit" aria-label="Jednostka">
                <option value="minutes">minut</option>
                <option value="hours">godzin</option>
                <option value="days">dni</option>
              </select>
            </div>
            <small v-if="fieldError('scheduleConfig')" class="error">{{ fieldError('scheduleConfig') }}</small>
          </div>
        </template>

        <template v-if="form.scheduleType === 'cron'">
          <label class="field">
            <span>Wyrażenie cron <em>minuta godzina dzień miesiąc dzień-tygodnia</em></span>
            <input v-model="form.cronExpression" type="text" class="code" spellcheck="false" autocomplete="off" :aria-invalid="!!fieldError('scheduleConfig')" />
            <small v-if="fieldError('scheduleConfig')" class="error">{{ fieldError('scheduleConfig') }}</small>
            <small v-else class="hint">Np. <code>0 8 * * 1-5</code> to dni robocze o 8:00, <code>*/15 * * * *</code> co 15 minut.</small>
          </label>
          <label class="field">
            <span>Strefa czasowa</span>
            <select v-model="form.timezone" :aria-invalid="!!fieldError('timezone')">
              <option v-for="tz in timeZones" :key="tz" :value="tz">{{ tz }}</option>
              <option value="UTC">UTC</option>
            </select>
            <small v-if="fieldError('timezone')" class="error">{{ fieldError('timezone') }}</small>
          </label>
        </template>

        <div v-if="form.scheduleType !== 'once'" class="pair">
          <label class="field">
            <span>Od <em>puste = od teraz</em></span>
            <input v-model="form.startAt" type="datetime-local" :aria-invalid="!!fieldError('startAt')" />
            <small v-if="fieldError('startAt')" class="error">{{ fieldError('startAt') }}</small>
          </label>
          <label class="field">
            <span>Do <em>opcjonalnie</em></span>
            <input v-model="form.endAt" type="datetime-local" :aria-invalid="!!fieldError('endAt')" />
            <small v-if="fieldError('endAt')" class="error">{{ fieldError('endAt') }}</small>
          </label>
        </div>

        <label class="check">
          <input v-model="form.enabled" type="checkbox" />
          Włączone, uruchamiaj według harmonogramu
        </label>
      </fieldset>

      <footer class="sheet-foot">
        <button type="button" class="button ghost" @click="emit('close')">Anuluj</button>
        <button type="submit" class="button primary" :disabled="saving">
          {{ saving ? 'Zapisywanie…' : isEdit ? 'Zapisz zmiany' : 'Utwórz zadanie' }}
        </button>
      </footer>
    </form>
  </dialog>
</template>

<style scoped>
.sheet {
  width: min(36rem, calc(100vw - 2rem));
  max-height: calc(100dvh - 2rem);
  padding: 0;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--panel);
  color: var(--ink);
}
.sheet::backdrop {
  background: rgb(5 10 20 / 0.7);
}
.form {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  padding: 1.25rem 1.5rem 1.5rem;
}
.sheet-head,
.sheet-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}
.sheet-head h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: 1.5rem;
  font-weight: 600;
}
.sheet-foot {
  justify-content: flex-end;
}
fieldset {
  display: flex;
  flex-direction: column;
  gap: 0.9rem;
  margin: 0;
  padding: 0;
  border: 0;
}
legend {
  margin-bottom: 0.6rem;
  font-family: var(--font-display);
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--signal);
}
.field {
  display: flex;
  flex-direction: column;
  gap: 0.35rem;
  font-size: 0.9rem;
}
.field > span em {
  font-style: normal;
  color: var(--muted);
  margin-left: 0.35rem;
}
.pair {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.9rem;
}
.inline {
  display: flex;
  gap: 0.5rem;
}
.inline input {
  width: 6rem;
}
.segmented {
  display: flex;
  border: 1px solid var(--line);
  border-radius: 10px;
  padding: 3px;
  gap: 3px;
}
.segmented label {
  flex: 1;
  text-align: center;
  padding: 0.45rem 0.5rem;
  border-radius: 7px;
  cursor: pointer;
  color: var(--muted);
}
.segmented label.active {
  background: var(--signal);
  color: var(--night);
  font-weight: 600;
}
.segmented label:has(input:focus-visible) {
  outline: 2px solid var(--signal);
  outline-offset: 2px;
}
.segmented input {
  position: absolute;
  opacity: 0;
  pointer-events: none;
}
.check {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  font-size: 0.9rem;
}
.check input {
  width: 1.1rem;
  height: 1.1rem;
  accent-color: var(--signal);
}
.code {
  font-family: var(--font-code);
}
.checklist {
  gap: 0.45rem;
}
.checklist em {
  font-style: normal;
  font-size: 0.8rem;
}
.hint {
  color: var(--muted);
}
.hint code {
  font-family: var(--font-code);
  color: var(--ink);
}
.error {
  color: var(--fail);
}
.form-error {
  margin: 0;
  padding: 0.65rem 0.8rem;
  border-radius: 8px;
  background: rgb(240 119 106 / 0.12);
  color: var(--fail);
}
.form-error-list {
  margin: 0;
  padding-left: 1.2rem;
  color: var(--fail);
  font-size: 0.85rem;
}
@media (max-width: 30rem) {
  .pair {
    grid-template-columns: 1fr;
  }
  .form {
    padding: 1rem;
  }
}
</style>
