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
| `ResultCache` | `core/result.cache.ts` | TTL, single-flight, minimalny odstęp wymuszonego odświeżenia, stale-if-error (ostatnie dobre dane do 6 h) | nie trwa po restarcie |
| `radar.deliver` | `scheduler/actions/radar-deliver.action.ts` | adapter do schedulera: runner → digest → Telegram/e-mail | do `task_executions.result` trafia tylko podsumowanie |

## Kontrakt wyniku

Każde uruchomienie modułu daje `ModuleResult` (`status: success | partial | error`, `fetchedAt`,
`dataAsOf`, `data`, `warnings`, `error`). Grupa / lista daje `RunResult` z wynikiem każdego
modułu osobno i statusem zbiorczym. Błąd modułu to **dane** (HTTP 200), nie błąd API.

`dataAsOf` = prawdziwa data danych według źródła (np. data tabeli NBP). Nie udajemy, że dane są „z dziś”.

**Stale-if-error:** gdy źródło zawiedzie, a cache ma jego ostatni udany wynik nie starszy niż 6 h, zwracany jest ten
wynik ze `status: 'partial'`, `stale: true`, prawdziwym (starym) `fetchedAt` i ostrzeżeniem w `warnings[0]`,
np. „Open-Meteo nie odpowiada (Źródło zwróciło błąd 503). Pokazuję dane z 12:00.”. Dashboard i raport pokazują
to ostrzeżenie. Źródło jest odpytywane ponownie po 30 s; gdy wróci, dane są znowu świeże. Starsze niż 6 h → zwykły błąd.

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
Moduły podrzędne przechodzą przez ten sam runner (cache, limity, timeouty) — agregator sam niczego
nie pobiera. Zagnieżdżenie jest ograniczone (`maxDepth`).

Wzorzec: `composites/morning-overview.module.ts` (używany w raportach schedulera; na dashboardzie nie ma
osobnej sekcji, bo powielałaby pozostałe). Zwraca listę `OverviewBlock` — każdy blok ma `itemKind`
(np. `news`, `alert`), więc raport renderuje go tymi samymi rendererami co zwykłe moduły.
Status bloku wynika ze statusów modułów pod spodem; awaria jednego źródła daje blok `partial`/`error`,
a reszta przeglądu działa dalej.

Nowy agregator:
1. plik w `composites/` z `defineModule({ kind: 'composite', dependsOn, itemKind: 'overview-block', ... })`;
2. w `execute`: `const run = await ctx.run({ kind: 'modules', ids })`, wybór i sortowanie elementów, `block(...)`;
3. rejestracja w `radar.catalog.ts` **po** modułach, od których zależy.

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

### Gotowe konfiguracje (w formularzu: akcja **Radar**)

| Scenariusz | Harmonogram | `actionConfig` |
|---|---|---|
| A — osobne zadania | cron `0 7 * * *`, `5 7 * * *`, `10 7 * * *`, strefa `Europe/Warsaw` | po jednym zadaniu: `{ "target": { "kind": "module", "id": "weather.current" }, "channel": { "type": "telegram", "chatId": "<id>" } }`, potem `news.rmf.poland`, `finance.nbp.currencies` |
| B — jedna grupa | cron `0 7 * * *` | `{ "target": { "kind": "group", "id": "news.poland" }, "channel": { "type": "telegram", "chatId": "<id>" }, "maxItemsPerModule": 5 }` |
| C — przegląd poranny | cron `0 7 * * 1-5` (dni robocze) | `{ "target": { "kind": "module", "id": "morning.overview" }, "channel": { "type": "telegram", "chatId": "<id>" }, "maxItemsPerModule": 7 }` |
| własna lista | dowolny | `{ "target": { "kind": "modules", "ids": ["weather.current", "alerts.imgw", "finance.nbp.currencies"] }, ... }` |

Uwaga: zadanie z id modułu, którego już nie ma w katalogu (np. usunięte TVN24), kończy się błędem
„Invalid action config” bez ponowień — widać go w historii wykonań; wystarczy edytować zadanie.

## Pogoda: źródło zapasowe

`sources/weather/weather.modules.ts` najpierw pyta **Open-Meteo** (1 ponowienie), a gdy nie odpowie — **MET Norway**
(`sources/weather/met-norway.ts`, Locationforecast 2.0 `complete`; darmowe, bez klucza, CC BY 4.0).
Wynik ma wtedy `source.name = "MET Norway (zapasowe)"` i atrybucję MET — widać to w nagłówku sekcji i w raporcie.

- MET Norway wymaga User-Agenta z kontaktem (`RADAR_USER_AGENT` w `http/safe-fetch.ts`) i szanowania cache:
  jedno zapytanie na 30 min, wspólne dla obu modułów pogody.
- Różnice: MET nie podaje porywów wiatru ani prawdopodobieństwa opadów (pola `null` → UI pokazuje ilość opadów w mm),
  ani wschodu/zachodu słońca; symbole MET są tłumaczone na kody WMO (`symbolToWmo`).
- Oba źródła niedostępne → błąd modułu z obiema przyczynami; wtedy działa stale-if-error (ostatnie dobre dane do 6 h).

## Znane ograniczenia

- Brak testów automatycznych modułów Radaru (świadoma decyzja na tym etapie) — weryfikacja: `npx tsc`, build i ręczne
  wywołania API. Kontrakty są jednak walidowane w runtime (zod) na wejściu z każdego źródła.
- Cache w pamięci jest osobny dla API i Workera i znika po restarcie/deployu — pierwsze odświeżenie po wdrożeniu trwa dłużej,
  a awaria źródła tuż po restarcie daje błąd (nie ma jeszcze „ostatnich dobrych danych”).
- `alerts.warsaw` to filtr słów kluczowych na RSS ZTM/WTP (bez daty końca komunikatu) — może pokazywać komunikaty już nieaktualne.
- IMGW hydro filtrowane po województwie i nazwie rzeki (brak TERYT) — obejmuje też odcinki Wisły daleko od Warszawy.
- Źródła mogą blokować IP serwerów (tak było z TVN24 i stronami artykułów thehackernews.com) — nowe źródło sprawdzaj z serwera.
- jsdom parsuje HTML synchronicznie: duży artykuł może na ~100–300 ms zająć proces API (limit 2 naraz, 3 MB).

## API

Wszystko pod `/api/radar`, za logowaniem i CSRF.

| Metoda | Ścieżka | Wynik |
|---|---|---|
| GET | `/dashboard` | `DashboardLayout` — układ sekcji + wyniki z cache + domeny czytnika |
| GET | `/articles/read?url=` | `ArticleView` — tryb czytania (429, gdy czytnik zajęty) |
| GET | `/modules` | `RadarModuleInfo[]` |
| GET | `/groups` | `RadarGroupInfo[]` |
| POST | `/modules/:id/run` body `{ force? }` | `ModuleResult` |
| POST | `/groups/:id/run` body `{ force? }` | `RunResult` |
| POST | `/run` body `{ moduleIds, force? }` (max 20) | `RunResult` |

`force: true` pomija cache, ale nie częściej niż raz na 60 s na moduł (ochrona źródeł).

## Dashboard (Home)

Frontend: `packages/frontend-vue-pwa/src/radar/`. Trasy (`src/router.ts`): `/` — Radar, `/scheduler/:taskId?` — scheduler
(stare linki `/#/<id>` są przekierowywane).

```
GET /api/radar/dashboard  → układ sekcji + wyniki z cache (natychmiast, bez pytania źródeł)
   └─ każda sekcja osobno: POST /api/radar/run { moduleIds }   (serwer i tak odpowiada z cache, gdy świeże)
   └─ „Odśwież” sekcji / „Odśwież wszystko”: to samo z force: true
```

- Układ sekcji jest na serwerze: `radar.dashboard.ts` (`SECTIONS`) — sekcja = lista grup/modułów.
- `useDashboard.ts` — stan per sekcja (`loading`, `error`, `results`); odpowiedzi spóźnione względem nowszego
  odświeżenia są ignorowane; automatyczne odświeżanie co 10 min, gdy karta jest widoczna.
- `RadarSection.vue` — ramka sekcji i wszystkie stany (ładowanie, błąd zapytania, wszystkie źródła padły,
  część padła, brak danych) + atrybucje źródeł.
- `SectionBody.vue` — renderuje wyniki według `itemKind`; wiadomości dzieli po kategorii (np. IT / Bezpieczeństwo).
- `SectionTabs.vue` + `HomePage.vue` — przyklejony pasek, płynne przewijanie, aktywna zakładka z `IntersectionObserver`,
  adres `/#finance` pozwala wrócić do sekcji.

### Jak dodać sekcję

1. Wpis w `SECTIONS` w `radar.dashboard.ts`: `{ id: 'security', title: 'Bezpieczeństwo', modules: [{ group: 'news.security' }] }`.
2. Jeśli moduły zwracają nowy `itemKind` — komponent w `src/radar/items/` i jedna linia w `SectionBody.vue`.
Zakładka, przewijanie, stany i odświeżanie działają bez dodatkowego kodu.

## Przeczytane (newsy i alerty)

Oznaczony news albo alert znika z dashboardu i nie trafia do przeglądu porannego (Telegram/e-mail).

- Klucz: `newsReadKey(url)` = `news:<kanoniczny URL>`, `alertReadKey(alert)` = `alert:<id>|<issuedAt ?? validFrom>`
  (`packages/shared/models/read-items.ts` — ta sama funkcja na serwerze i we frontendzie). Zmieniona wersja
  ostrzeżenia (nowy czas wydania) ma nowy klucz, więc znów się pokazuje.
- Baza: `radar_read_items` (`item_key`, `title`, `source`, `read_at`, `expires_at`; migracje `004`, `005`).
  Termin ważności (`read-marks.ts`): newsy 14 dni; alerty do końca ważności + 1 dzień, bez końca 60 dni
  (zakres 1–400 dni). Wygasłe wpisy są kasowane przy zapisie.
- API: `POST /api/radar/read-items` `{ kind: 'news', url, title?, source? }` albo
  `{ kind: 'alert', id, issuedAt, validFrom, expiresAt, title?, source? }` (204; klucz liczy serwer),
  `DELETE /api/radar/read-items?key=…` (204); `GET /api/radar/dashboard` zwraca `readKeys` (ważne oznaczenia).
- Filtr działa w prezentacji, nie w modułach (cache modułów nie zna stanu użytkownika):
  `NewsList`/`AlertList` pomijają oznaczone; `radar.deliver` przekazuje klucze do `buildDigest` (`skipKeys`) —
  te same klucze służą tam do usuwania duplikatów. Bloki „top 3” przeglądu porannego są liczone w module
  zbiorczym, więc po odfiltrowaniu mogą mieć mniej pozycji. Gdy odczyt z bazy się nie uda, przegląd idzie bez filtra.
- Frontend (`src/radar/read-items.ts`, `items/MarkReadButton.vue`): przycisk ✓ przy newsie i alercie,
  „Przeczytane” w pasku czytnika. Ukrycie natychmiastowe, „Cofnij” przez 6 s; błąd zapisu przywraca wpis.
  Otwarcie artykułu NIE oznacza go jako przeczytany.
- Sekcja, w której wszystkie newsy/alerty są oznaczone (`allItemsRead`), jest ukryta, a jej zakładka u góry
  wyszarzona i nieklikalna. „Cofnij” przywraca sekcję. Sekcje z pogodą/kursami nigdy nie są uznawane za przeczytane.

## Article Reader (tryb czytania)

Pobiera **jeden** artykuł na żądanie użytkownika i zwraca oczyszczony tekst. Nic nie trafia do bazy;
w pamięci procesu API jest cache (30 min sukces, 5 min błąd, max 100 adresów). Podczas pobierania RSS treści
artykułów nie są pobierane.

```
GET /api/radar/articles/read?url=…  →  ArticleView { status: success | unavailable | unsupported, … }
  1. canonicalUrl (http→https, bez #, bez utm_*) — niepoprawny adres → unsupported (adres nie jest odsyłany)
  2. domena na liście `radarConfig.reader.allowedDomains` (domena lub subdomena) — inaczej unsupported
  3. safe-fetch: https, max 3 przekierowania (każde znowu przez allowlistę), 3 MB, timeout 15 s
     + SSRF guard (reader/ssrf-guard.ts): połączenie tylko na publiczne IP, sprawdzane w DNS lookup samego połączenia
  4. jsdom (bez skryptów i zasobów) → @mozilla/readability → < 600 znaków = unavailable (paywall/nietypowa strona)
  5. sanitize-html: tylko struktura tekstu i linki (bez obrazków, iframe, stylów, atrybutów on*), linki z rel="noopener noreferrer nofollow"
```

- Limit: 2 ekstrakcje naraz, kolejka 8, potem HTTP 429 (jsdom jest ciężki dla 2 vCPU).
- Paywalle i logowania **nie są omijane** — czytnik dostaje to, co strona pokazuje publicznie.
- Frontend: `/read?url=…` (`src/radar/ReaderPage.vue`). Kliknięcie tytułu newsa z dozwolonej domeny
  (lista z `GET /api/radar/dashboard` → `readerDomains`) otwiera czytnik; obok jest mały link „Oryginał”.
  Gdy czytnik nie przygotuje tekstu (`unsupported`/`unavailable` albo błąd API), strona sama przechodzi
  do oryginału (`location.replace` — „Wstecz” wraca na dashboard). Tytuły z innych domen otwierają oryginał
  w nowej karcie. Link do oryginału renderowany tylko dla http(s).
- Domeny (2026-11-02): źródła RSS (w tym `zaufanatrzeciastrona.pl`) + `dou.ua` (z IP serwera artykuły DOU dostają 403 od Cloudflare — w praktyce zawsze otwiera się oryginał), `dev.ua`, `dobreprogramy.pl`, `geekweek.interia.pl` (2026-11-03; `justjoin.it` był już przez Polskich Programistów) + serwisy agregowane przez Polskich Programistów
  (lista w `radar.config.ts`; YouTube celowo pominięty).
- Dodanie domeny: wpis w `reader.allowedDomains`; najpierw sprawdź, że strona artykułu odpowiada 200 dla zwykłego
  klienta HTTP (np. thehackernews.com zwracał 403).

## Jak dodać nowe źródło RSS/Atom

Bez pisania kodu — jeden wpis w `sources/news/news.feeds.ts`:

```ts
{ id: 'news.example', name: 'Example', category: 'it', url: 'https://example.com/feed.xml',
  source: { name: 'Example', homepage: 'https://example.com' }, description: '…', cacheTtlMinutes: 60 },
```

Moduł trafia automatycznie do grupy swojej kategorii i do `news`. Przed dodaniem sprawdź:
1. `curl -s -o /dev/null -w '%{http_code} %{redirect_url}' URL` — ma być 200 **bez przekierowania**
   (podaj adres docelowy; ewentualny inny host dodaj w `extraHosts`).
2. Czy to RSS 2.0, RSS 1.0 (RDF) albo Atom.
3. Regulamin źródła i czy serwis nie blokuje botów (np. PAP — Incapsula; nie obchodzimy tego).
4. Rozmiar (domyślny limit 2 MB; `maxBytes`).

Źródło z własnym API (nie RSS) = osobny plik z `defineModule`, wynik w modelu `NewsItem`
(wzorzec: `sources/finance/nbp.modules.ts` — JSON API z walidacją zod).

## Przetwarzanie wiadomości

```
feed XML ─ parseFeed ─▶ FeedEntry[] ─ normalizeFeedEntry ─▶ NewsItem (bez relevance)
   ─ dedupeNews ─ exclude ─ sort (data malejąco) ─ limit 30 ─ score ─▶ NewsItem[]
```

- `parsing/feed.parser.ts` — RSS 2.0 / RDF / Atom → jeden kształt. `fast-xml-parser` nie obsługuje encji
  zewnętrznych (XXE) i ogranicza rozwijanie encji.
- `parsing/text.ts` — HTML z feedu → krótki czysty tekst (wynik zawsze jest renderowany jako tekst).
- `parsing/news.normalize.ts` — kanoniczny URL (tylko http/https, bez `#`, bez `utm_*`, `fbclid`…), daty RFC 822/ISO → ISO,
  opis równy tytułowi → `null`, id = GUID albo hash URL.
- `parsing/dedupe.ts` — duplikaty w obrębie jednego wyniku: po URL, po GUID i po znormalizowanym tytule w obrębie źródła.
  Między modułami (np. ten sam artykuł RMF w feedzie „Polska” i „Warszawa”) deduplikuje raport (`delivery/digest.ts`).
- Obrazków celowo nie ma w modelu (decyzja: CSP i prywatność).

## Ocena istotności (bez AI)

Reguły w `radar.config.ts` → `news.relevance`:

- słowo kluczowe `vue` = całe słowo, `warszaw*` = przedrostek (odmiana: Warszawie, warszawskich),
  `sztuczn* inteligencj*` = fraza; wielkość liter bez znaczenia;
- punkty: waga × 2 za trafienie w tytule, × 1 tylko w opisie; +2 dla wpisów ≤ 3 h, +1 dla ≤ 12 h;
- wpis starszy niż 7 dni (`staleAfterHours`) ma 0 pkt (dopasowania nadal są w `matches`);
- `excludeKeywords` — wpisy z takim słowem w tytule są odrzucane.

Moduły zwracają wpisy od najnowszych, z polem `relevance: { score, matches }`; ranking po istotności
robi konsument (dashboard, przegląd poranny) — `byRelevance` w `parsing/relevance.ts`.

## Moduły

| id | Źródło | Cache | Uwagi |
|---|---|---|---|
| `finance.nbp.currencies` | api.nbp.pl, tabela A (2 ostatnie) | 30 min | EUR, USD (`radar.config.ts`), zmiana vs poprzednia tabela |
| `finance.nbp.gold` | api.nbp.pl, ceny złota (2 ostatnie) | 30 min | PLN za 1 g |
| `news.rmf.poland` | RSS | 15 min | Polska |
| `news.rmf.world` | RSS | 15 min | Świat |
| `news.rmf.warsaw` | RSS | 15 min | Warszawa |
| `news.rmf.economy`, `news.bankier` | RSS | 15 min | Gospodarka (nie ma sekcji na dashboardzie; dostępne w schedulerze) |
| `news.dou`, `news.devua` | RSS (`dou.ua/feed/`, `dev.ua/rss`) | 30 min | IT (sekcja „IT”), po ukraińsku. DOU: tylko `/feed/` (~5 wpisów) — kanały kategorii DOU (`/lenta/news/feed/`, `/lenta/articles/feed/`, `/forums/feed/`) dostają z IP serwera 403 od Cloudflare |
| `news.polscyprogramisci` | strona główna polscyprogramisci.pl (parsowanie HTML, brak RSS/API) | 30 min | IT (sekcja „IT”). Karty `article.article-card`: tytuł, link do oryginału, zajawka, serwis, data (sam dzień → północ czasu lokalnego). Pomija wpisy z hostów, które czytamy bezpośrednio (Sekurak, Niebezpiecznik…). Brak kart = błąd `PARSE_ERROR` (zmiana układu strony) |
| `news.cert.pl`, `news.sekurak`, `news.niebezpiecznik`, `news.zaufana` | RSS/Atom (Zaufana: `/feed.xml` — `/feed/` przekierowuje 301) | 60 min | Bezpieczeństwo IT (sekcja „IT” na dashboardzie) |
| `weather.current` | Open-Meteo, zapasowo MET Norway | 15 min | warunki teraz + prognoza godzinowa (12 h) |
| `weather.forecast` | Open-Meteo, zapasowo MET Norway | 60 min | prognoza dzienna (7 dni) |
| `alerts.imgw` | danepubliczne.imgw.pl (meteo + hydro) | 10 min | meteo: filtr TERYT powiatu (1465); hydro: województwo + zlewnia (`wisł*`); susza (stopień -1) = `info`. Wymagana atrybucja IMGW-PIB |
| `alerts.gios` | api.gios.gov.pl v1 | 30 min | w grupie `weather` (sekcja Pogoda): stacje z `giosStationIds` — domyślnie tylko ul. Grochowska (20487) — z indeksem i stężeniami PM10/PM2.5/NO2; pusta lista = wszystkie stacje w mieście (sam indeks). Lista stacji i czujników w pamięci na dobę. API wymaga `Accept: application/ld+json`. Id z prefiksem `alerts.` zostało ze względu na zgodność zadań schedulera |
| `alerts.warsaw` | RSS ZTM + WTP | 30 min | filtr słów (`transportKeywords`), ostatnie 14 dni |
| `morning.overview` | moduł zbiorczy | 5 min | pogoda, alerty (IMGW od żółtego, powietrze, 3 komunikaty), top 3 Polska/Świat/IT po istotności, kursy, złoto |

**Wiek newsów:** wszystkie moduły wiadomości (RSS i Polscy Programiści) odrzucają wpisy starsze niż `news.maxAgeDays`
(3 dni, `radar.config.ts`); wpisy bez daty zostają. Źródła publikujące rzadko (CERT, Niebezpiecznik) bywają przez to puste.

Grupy: `finance`, `weather` (pogoda + jakość powietrza), `alerts` (IMGW + komunikacja), `news.poland`, `news.world`, `news.warsaw`, `news.economy`,
`news.it` (DOU, dev.ua, Polscy Programiści), `news.security`, `news` (wszystkie wiadomości). Sekcja „IT” = `news.it` + `news.security`.

**Tylko źródła polskojęzyczne** (decyzja z 2026-11-02; wyjątek z tego samego dnia: ukraińskie DOU i dev.ua w sekcji IT): usunięto BBC, The Guardian, Hacker News, The Hacker News,
blogi Node.js/Vue/TypeScript/Docker/PostgreSQL, wydania z GitHuba, JavaScript Weekly i Simon Willison.

Daty bez strefy z IMGW i GIOŚ („2026-11-02 21:00:00”) są przeliczane z `Europe/Warsaw` (`core/time.ts`, z obsługą zmiany czasu).

Odrzucone źródła: TVN24 (403 dla IP serwera; z domowego IP działa), PAP (blokada anty-botowa), um.warszawa.pl/rss (404), HF blog (ok. 900 wpisów, mało przydatne),
Kubernetes blog (1,1 MB), Reddit (blokuje serwery, niejasny regulamin), HN „best” (pokrywa się z „top”),
Warszawa 19115 / api.um.warszawa.pl (wymaga klucza API — decyzja: na razie nie), kanały kategorii ZTM/WTP (403).
