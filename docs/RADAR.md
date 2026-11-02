# Personal Radar — przewodnik dewelopera

Personal Radar pobiera informacje z zewnętrznych źródeł **na żądanie**, normalizuje je
i zwraca w jednolitym formacie. Niczego nie zapisuje w PostgreSQL — jedynie krótko
trzyma wyniki w pamięci procesu (cache).

Kod: `packages/backend/src/modules/radar/`, typy wspólne: `packages/shared/models/radar.model.ts`.

## Architektura w jednym obrazku

```
            ┌─────────────── API (Express) ───────────────┐      ┌──────── Worker (pg-boss) ────────┐
 Vue ──HTTP─▶ /api/radar/*  (radar.controller.ts)         │      │ SchedulerExecutor                │
            │        │                                    │      │   └─ action "radar.deliver"      │
            │        ▼                                    │      │          │                       │
            │   ModuleRunner ◀── ModuleRegistry           │      │   ModuleRunner ◀── ModuleRegistry│
            │     │  cache (pamięć), limit równoległości, │      │     │                            │
            │     │  timeout, izolacja błędów             │      │     ▼                            │
            │     ▼                                       │      │   digest → Telegram / e-mail     │
            │   moduły ──safe-fetch──▶ źródła (https)     │      └──────────────────────────────────┘
            └─────────────────────────────────────────────┘
```

API i Worker to **osobne procesy** — każdy ma własny rejestr, runner i cache (`radar.catalog.ts`).

## Odpowiedzialności

| Element | Plik | Robi | Nie robi |
|---|---|---|---|
| Moduł | `sources/**` | pobiera, parsuje, waliduje odpowiedź źródła, normalizuje do modelu | nie zapisuje do bazy, nie wysyła wiadomości, nie łapie własnych błędów „na cicho” |
| `safe-fetch` | `http/safe-fetch.ts` | https, allowlista hostów (też po przekierowaniach), limit rozmiaru, retry z backoffem, dekodowanie znaków | |
| `ModuleRegistry` | `core/module.registry.ts` | katalog modułów i grup, walidacja przy starcie | |
| `ModuleRunner` | `core/module.runner.ts` | uruchamia moduły (limit równoległości, timeout, anulowanie), waliduje elementy, zamienia błędy na `ModuleResult` ze statusem `error`, cache | nigdy nie rzuca z powodu modułu |
| `ResultCache` | `core/result.cache.ts` | TTL, single-flight, minimalny odstęp wymuszonego odświeżenia | nie trwa po restarcie |
| `radar.deliver` | `scheduler/actions/radar-deliver.action.ts` | adapter do schedulera: runner → digest → Telegram/e-mail | do `task_executions.result` trafia tylko podsumowanie |

## Kontrakt wyniku

Każde uruchomienie modułu daje `ModuleResult` (`status: success | partial | error`, `fetchedAt`,
`dataAsOf`, `data`, `warnings`, `error`). Grupa / lista daje `RunResult` z wynikiem każdego
modułu osobno i statusem zbiorczym. Błąd modułu to **dane** (HTTP 200), nie błąd API.

`dataAsOf` = prawdziwa data danych według źródła (np. data tabeli NBP). Nie udajemy, że dane są „z dziś”.

## Jak dodać nowy moduł

1. Utwórz plik w `sources/<grupa>/`, np. `sources/finance/ecb.modules.ts`.
2. Zdefiniuj:
   - schemat zod **odpowiedzi źródła** (tylko używane pola) — przekazujesz go do `http.getJson`;
   - schemat zod **znormalizowanego elementu** (`itemSchema`) — runner sprawdza nim każdy element;
   - fabrykę zwracającą `defineModule({...})`.

```ts
export function createEcbModule() {
  return defineModule<CurrencyRate>({
    id: 'finance.ecb.rates',          // unikalne, z kropkami
    name: 'Kursy EBC',
    group: 'finance',
    description: '…',
    source: { name: 'EBC', homepage: 'https://www.ecb.europa.eu' },
    itemKind: 'currency-rate',        // jak renderować elementy (dashboard, Telegram)
    kind: 'collector',
    allowedHosts: ['data-api.ecb.europa.eu'],   // tylko te hosty są dozwolone
    itemSchema: currencyRateSchema,
    cacheTtlSeconds: 3600,
    async execute({ http, signal }) {
      const raw = await http.getJson('https://data-api.ecb.europa.eu/…', upstreamSchema, { signal })
      return { data: normalize(raw), dataAsOf: raw.date }
    },
  })
}
```

Zasady:
- Zawsze przekazuj `signal` do zapytań — inaczej timeout nie przerwie połączenia.
- Spodziewane problemy zgłaszaj przez `throw new RadarSourceError(code, message)`; komunikat musi być
  bezpieczny do pokazania użytkownikowi.
- Brak części danych → zwróć `warnings` (status `partial`), nie rzucaj błędu.
- Nowy rodzaj elementu → dodaj typ w `shared/models/radar.model.ts`, wartość do `RadarItemKind`
  i renderer linii w `delivery/digest.ts`.

## Rejestracja modułu i tworzenie grup

Wszystko w `radar.catalog.ts` — jawna lista, bez dynamicznych importów:

```ts
.register(createEcbModule())
.defineGroup({ id: 'finance', name: 'Finanse', description: '…', moduleIds: ['finance.nbp.currencies', 'finance.ecb.rates'] })
```

Błędy konfiguracji (powtórzone id, nieznany moduł w grupie, cykl modułów zbiorczych) zatrzymują start
procesu — zobaczysz je od razu, a nie o 7:00 rano.

## Moduł zbiorczy (agregator)

`kind: 'composite'`, `dependsOn: [...]` z listą modułów, a w `execute` używasz `ctx.run(target)`.
Moduły podrzędne przechodzą przez ten sam runner (cache, limity, timeouty). Zagnieżdżenie jest ograniczone (`maxDepth`).

## Podpinanie do schedulera

W formularzu zadania wybierz akcję **Radar** (`radar.deliver`). Konfiguracja (`actionConfig`):

```jsonc
{
  "target": { "kind": "group", "id": "finance" },   // albo { kind: "module", id } / { kind: "modules", ids: [...] }
  "channel": { "type": "telegram", "chatId": "-100123" }, // albo { type: "email", to: ["a@b.pl"], subject: "…" }
  "maxItemsPerModule": 5,
  "title": "opcjonalny nagłówek (domyślnie nazwa zadania)"
}
```

Zachowanie:
- id modułów/grup są sprawdzane przy zapisie zadania;
- brak `TELEGRAM_BOT_TOKEN`/SMTP → błąd bez ponowień, zanim cokolwiek zostanie pobrane;
- wszystkie moduły z błędem → wykonanie się nie udaje i scheduler ponawia je z backoffem;
- część modułów z błędem → raport jest wysyłany, a niedostępne sekcje są oznaczone.

## API

Wszystko pod `/api/radar`, za logowaniem i CSRF.

| Metoda | Ścieżka | Wynik |
|---|---|---|
| GET | `/modules` | `RadarModuleInfo[]` |
| GET | `/groups` | `RadarGroupInfo[]` |
| POST | `/modules/:id/run` body `{ force? }` | `ModuleResult` |
| POST | `/groups/:id/run` body `{ force? }` | `RunResult` |
| POST | `/run` body `{ moduleIds, force? }` (max 20) | `RunResult` |

`force: true` pomija cache, ale nie częściej niż raz na 60 s na moduł (ochrona źródeł).

## Moduły

| id | Źródło | Cache | Uwagi |
|---|---|---|---|
| `finance.nbp.currencies` | api.nbp.pl, tabela A (2 ostatnie) | 30 min | EUR, USD, CHF, GBP (`radar.config.ts`), zmiana vs poprzednia tabela |
| `finance.nbp.gold` | api.nbp.pl, ceny złota (2 ostatnie) | 30 min | PLN za 1 g |

Grupy: `finance`.
