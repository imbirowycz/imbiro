# Okazje: śledzenie cen i ogłoszeń przez domowy zbieracz — projekt

Data: 2026-11-14 · Branch: `feature/okazje` (z `dev`) · Status: zaakceptowany, etap 1 zrealizowany

## Po co

Chcę polować na okazje: obserwować wybrane produkty pod kątem zmiany ceny oraz nowe
ogłoszenia (np. samochód danej marki). Bez API sklepów — zwykłe pobieranie stron.

Poprzednie podejście (`feature/ceny`, „Łowca cen”) miało dobre funkcje, ale nie dało się
go używać, bo sklepy blokowały IP serwera Hetzner. Rozwiązanie: strony pobiera komputer
w domu (docelowo stary laptop z Linuxem, na razie Mac), a Hetzner pozostaje jedynym
miejscem z bazą, logiką i PWA.

## Co wiemy z testów

Test z 2026-11-14 na Macu w domowej sieci, jedno zapytanie na serwis (strony wyszukiwania):

| Serwis | Zwykły fetch (Node) | Chromium bez okna | Chrome z oknem i profilem |
|---|---|---|---|
| MediaMarkt, x-kom, Empik, morele | OK | OK | — |
| Media Expert, RTV Euro AGD, avans, electro, Allegro, Komputronik, OLX | 403 | 403 | OK |
| Ceneo, Otomoto | niepewne | blokada | strona wyników przyszła (200), ceny niepotwierdzone |
| Amazon | pusta strona | OK | pusta strona |

Wnioski:

- Zbieracz używa **prawdziwego Chrome'a z oknem i stałym profilem** — to jedyny sposób,
  który przeszedł oporne sklepy. Jedna ścieżka pobierania, bez trybów http/browser.
- To był pojedynczy strzał. Nie wiadomo, jak sklepy zareagują na regularne odpytywanie,
  więc odstępy na domenę i status każdego źródła są obowiązkowe.

## Cele

1. Jedna zakładka w PWA: artykuły jako karty, dodawanie/edycja na tym samym widoku,
   szczegóły w popupie (historia zmian cen, źródła ze statusem, zarządzanie źródłami).
2. Pobieranie stron z domowego IP przez osobny program w repo (`packages/collector`).
3. Całe sterowanie na Hetznerze: istniejący scheduler decyduje kiedy, a limity (ile naraz,
   odstęp na domenę, częstotliwość odpytywania) zbieracz dostaje z serwera.
4. Zbieracz przenośny: uruchomienie na Macu i na Linuxie różni się tylko plikiem `.env`.
5. Maksymalne wykorzystanie tego, co jest: scheduler, pg-boss, Telegram, migracje,
   logowanie, sprawdzony moduł cen z `feature/ceny`, istniejące tabele `price_*` z danymi.

## Poza zakresem

- API sklepów, płatne proxy, rozwiązywanie captch.
- Scheduler, baza albo logika cen na zbieraczu.
- Osobna strona-lista okazji (`/okazje` w starym kształcie), powiadomienia systemowe
  i dźwięk w PWA (`sw-notify.js`) — okazje widać na karcie i w popupie, a powiadamia Telegram.
- Kontenery `browser`, `home-relay`, `home-agent` z `feature/ceny` — nie wracają.
- „Znajdź źródła” (automatyczne wyszukiwanie sklepów przez Ceneo) — ewentualnie później.

## Czego unikamy (porażka, nawet gdy działa)

- Dwa miejsca z logiką harmonogramu albo parsowania cen.
- Otwieranie portów w domowej sieci.
- Merge całego `feature/ceny` — przenosimy wybrane pliki, dopasowane do układu `dev`.

## Rozważane podejścia

| | Podejście | Ocena |
|---|---|---|
| **A** | Przenieść moduł cen z `feature/ceny`, wymienić tylko pobieranie na zbieracz, frontend napisać od nowa | **wybrane** — funkcje były OK, tabele i dane już są na produkcji |
| B | Napisać wszystko od zera | odrzucone — więcej pracy na ten sam efekt, utrata sprawdzonego wyciągania cen |
| C | Sam test z domu przed budową | wykonany jako pierwszy krok A (wyniki wyżej) |

## Architektura

```
PWA ──► API (Hetzner) ──► Postgres + pg-boss
            ▲   scheduler: akcja price.watch → zadania w kolejce prices.check
            │
            │  HTTPS, wychodzące z domu, token
            │  1) claim: „co pobrać?” → zadania + limity
            │  2) result: HTML + kod odpowiedzi
       Zbieracz (Mac → Linux) ──► Chrome ──► sklepy
```

### Przepływ jednego sprawdzenia

1. Scheduler uruchamia zadanie artykułu (akcja `price.watch`, jak w `feature/ceny`): dla
   każdego włączonego źródła wstawia job do kolejki pg-boss `prices.check`, z terminami
   rozrzuconymi w oknie losowania.
2. Zbieracz woła `POST /api/collector/claim`. API pobiera gotowe joby z kolejki
   (`boss.fetch`), zapisuje „zbieracz widziany teraz” i zwraca zadania wraz z limitami.
3. Zbieracz otwiera każdy adres w Chromie (z zachowaniem odstępu na domenę) i odsyła
   `POST /api/collector/results` z kodem HTTP, adresem końcowym i HTML.
4. API wyciąga cenę (przeniesiony `price-extract`), zapisuje pomiar, aktualizuje status
   źródła, ocenia okazje, wysyła Telegram i zamyka job (`boss.complete` / `boss.fail`).
5. Job pobrany, ale bez wyniku (laptop zgasł) wygasa w pg-boss i wraca do kolejki.

W pg-boss nikt nie „pracuje” na kolejce `prices.check` — jedynym odbiorcą jest zbieracz
przez API. Worker na Hetznerze wykonuje tylko `price.watch` (planowanie), jak inne akcje.

### Kontrakt API ↔ zbieracz

Typy w `packages/shared` (wspólne dla obu stron). Autoryzacja: `Authorization: Bearer
<COLLECTOR_TOKEN>`, porównanie odporne na timing; trasy poza sesją administratora.

`POST /api/collector/claim` → 
```ts
{
  settings: { pollSeconds, domainGapMinSeconds, domainGapMaxSeconds, pageTimeoutSeconds, maxJobsPerClaim },
  jobs: [{ jobId, url, waitFor?: string }]   // 0..maxJobsPerClaim
}
```

`POST /api/collector/results` (gzip, limit ciała ok. 8 MB) →
```ts
{ jobId, ok: boolean, httpStatus: number | null, finalUrl: string | null,
  html: string | null, durationMs: number, error?: { code, message } }
```

Wartości `settings` pochodzą z konfiguracji backendu (`config.prices`, zmienne `.env`
z domyślnymi wartościami). Zbieracz nie ma własnych limitów — stosuje to, co dostał.

### Zbieracz (`packages/collector`)

- Paczka workspace `@myorg/collector`, TypeScript uruchamiany przez `tsx`, zależności:
  `playwright` + typy z `@myorg/shared`. Nie trafia do obrazów Dockera na Hetznerze.
- Pętla: claim → pobierz → result → odczekaj `pollSeconds`. Brak bazy, schedulera, parsowania.
- Chrome: `launchPersistentContext` z `channel: 'chrome'`, okno widoczne, profil w katalogu
  danych zbieracza. Na Linuxie bez monitora: wirtualny ekran (`xvfb-run`) + usługa systemd.
- Konfiguracja tylko w `.env`: `API_URL`, `COLLECTOR_TOKEN`, opcjonalnie `PROFILE_DIR`.
  Przeniesienie Mac → Linux = skopiowanie folderu i podmiana `.env`.
- Ochrona sieci domowej: tylko `https`, a adresy rozwiązujące się do sieci prywatnych
  (192.168/16, 10/8, localhost itd.) są odrzucane — wzór: `ip-guard.js` z `feature/ceny`.
- Błędy sieci do API: ponawianie z rosnącym odstępem, bez wychodzenia z procesu.
- `README.md` w paczce: uruchomienie na Macu i instalacja na Linuxie.

### Backend (moduł `modules/prices`)

Przenoszone z `feature/ceny` i dopasowane do układu `dev` (`core/`, `composition.ts`,
publiczne `index.ts` modułu, klasy z kolaboratorami przez konstruktor):

- wyciąganie ceny (`price-extract`, `price-parse`, `price-html`) z testami i fixture'ami,
- ocena okazji (`price-evaluate`), powiadomienia (`price-notify`),
- repozytorium, serwis, schematy, kontroler (`/api/prices/*`), akcja `price.watch`,
  rozszerzenia `SchedulerService` (`createWithin` / `updateWithin` / `deleteWithin`),
- sprzątanie starych pomiarów w `db.cleanup`.

Zmiany względem starego modułu:

- Narzędzia formularza, które pobierały stronę z serwera („Sprawdź źródło”, „Pobierz HTML
  dla AI”, prompt AI), nie zostały przeniesione. Cena jest wykrywana automatycznie
  (JSON-LD / OpenGraph / microdata); dla stron bez takich danych źródło przyjmuje własny
  selektor CSS ceny. Zamiast testu przed zapisem: nowe źródło jest sprawdzane od razu.
- Nie ma API listy okazji (`/offers`). Tabela `price_offers` służy tylko temu, żeby o tej
  samej okazji nie powiadamiać dwa razy.

- `price-fetch` i `price-check` (pobieranie http/przeglądarka z serwera) znikają. Zamiast
  nich: nowy kontroler `collector.controller.ts` (claim/results) i przetwarzanie wyniku —
  dotychczasowa logika `PriceCheckWorker.process`, tylko że strona przychodzi ze zbieracza.
- „Sprawdź teraz” i „Sprawdź źródło” stają się asynchroniczne: wstawiają job z priorytetem,
  a PWA odświeża stan, aż pojawi się wynik.
- Kolumny `fetch_mode` / `preferred_fetcher` zostają w bazie, kod ich nie używa (moja decyzja:
  bez migracji usuwającej, dopóki nie przeszkadzają).
- Katalog predefiniowanych sklepów w kodzie (`price.catalog.ts`): nazwa, domena, szablon
  adresu wyszukiwarki sklepu, opcjonalna gotowa definicja wyciągania ceny.
- Stan zbieracza: jedna tabela z jednym wierszem (`last_seen_at`, nazwa hosta), zwracana
  w API listy artykułów.

Baza:

- Plik `006_prices.sql` wraca do repo **bez zmian** (na produkcji jest już zapisany
  w `schema_migrations`, więc tam się nie wykona; świeże bazy go dostaną).
- Nowa migracja `007_…`: stan zbieracza. Etap 2 dołoży własną migrację.
- Dane na produkcji zostają. 4 wyłączone zadania `price.watch` znów będą zrozumiałe dla
  kodu — włączenie ręcznie z PWA po wdrożeniu.

Konfiguracja: nowy klucz `.env` na serwerze `COLLECTOR_TOKEN` (stare `PRICE_BROWSER_TOKEN`,
`HOME_AGENT_TOKEN`, `HOME_PROXY_TOKEN` pozostają nieużywane). Caddy bez zmian — `/api/*`
już trafia do backendu.

### PWA — jedna zakładka „Okazje” (`/okazje`)

```
[+ Dodaj artykuł]                      zbieracz: online, 2 min temu
┌ Telewizor LG 55QNED80 ─────────────────────────────┐
│ najniżej 2 681,99 zł (morele)  · cel: 2 500 zł      │
│ źródła 4/5 OK  · sprawdzono 12:03   [okazja!]       │
│                         [edytuj] [wyłącz] [usuń]    │
└─────────────────────────────────────────────────────┘
        klik w kartę → popup
┌ LG 55QNED80 ──────────────────────────────────── ✕ ┐
│ Zmiany cen:  12.11 2 799 → 2 681,99 (morele) …      │
│ Źródła:                                             │
│  ✓ morele      2 681,99 zł   12:03  [wyłącz][usuń]  │
│  ✗ Ceneo       blokada       12:03  [wyłącz][usuń]  │
│  [+ dodaj źródło: predefiniowane ▾ | własny adres]  │
│  [Sprawdź teraz]                                    │
└─────────────────────────────────────────────────────┘
```

- Karta = sekcja artykułu: nazwa, najniższa aktualna cena i sklep, cena minimalna (cel),
  ile źródeł działa, czas ostatniego sprawdzenia, znacznik okazji; akcje edytuj / wyłącz
  śledzenie / usuń.
- Formularz dodawania i edycji rozwija się na tym samym widoku: nazwa, cena minimalna,
  częstotliwość sprawdzania, źródła (sklep z listy + adres produktu, albo własny adres),
  powiadomienie na Telegram.
- Popup: lista zmian cen od początku śledzenia (tylko zmiany, nie każdy pomiar), źródła
  z ostatnią ceną, czasem i statusem pobrania (OK / ostrzeżenie / nie działa / blokada +
  komunikat błędu), przy każdym wyłącz i usuń, dodawanie źródła, „Sprawdź teraz”.
- Wyłączenie pojedynczego źródła wymaga nowej kolumny `enabled` w `price_sources`
  (w migracji `007`).
- Pliki w `src/prices/` + `src/api/prices.ts`; stare strony z `feature/ceny` służą tylko
  jako ściągawka (formatowanie, wywołania API). Styl jak reszta aplikacji.

## Etapy

1. **Ceny od początku do końca**: backend + zbieracz na Macu + PWA. Każdy etap ma własny plan.
2. **Nowe ogłoszenia**: źródło typu „lista” (adres wyników wyszukiwania OLX / Otomoto /
   Allegro albo własny). Każde sprawdzenie zapisuje widziane oferty (adres, tytuł, cena);
   pierwsze tylko zapamiętuje stan, kolejne zgłaszają nowe adresy jako okazję
   `new_listing` + Telegram. Filtry: cena maksymalna, słowa kluczowe. Gotowe definicje dla
   OLX, Otomoto i Allegro w katalogu.
3. **Przeniesienie na Linuxa**: instalacja Chrome + Xvfb + systemd, podmiana `.env`.

## Testy

- Przeniesione testy jednostkowe modułu cen.
- Testy kontraktu HTTP (`src/test`): `/api/collector/*` — brak/zły token → 401, claim
  zwraca limity i zadania, result zapisuje pomiar i zamyka job; `/api/prices/*` bez sesji → 401.
- Zbieracz: test ochrony adresów prywatnych; pętla testowana z podstawionym „pobieraczem”.
- Ręcznie: lokalny stos (`npm run up`) + zbieracz na Macu, artykuł z 3–4 sklepami
  (w tym jeden oporny, np. Media Expert), sprawdzenie statusów i historii w PWA.

## Wdrożenie

Dopiero na wyraźne polecenie. Wymaga: backupu bazy, `COLLECTOR_TOKEN` w `/opt/imbiro/.env`,
`npm run deploy` z brancha, aktualizacji `docs/SERVER.md`.

## Zostaje dla wykonawcy

- Dokładne nazwy plików i podział klas w `modules/prices` po dopasowaniu do `dev`.
- Domyślne wartości limitów (punkt wyjścia: odpytywanie co 30 s, odstęp na domenę 30 s,
  limit strony 45 s, do 3 zadań na claim).
- Czas wygaśnięcia pobranego joba i liczba ponowień.
- Wygląd szczegółów karty i popupu w ramach istniejącego stylu aplikacji.

## Ryzyka

- Sklep zaczyna blokować także Chrome'a z domu → źródło dostaje status „blokada”,
  reszta działa dalej; nie obchodzimy captch.
- Laptop wyłączony → zadania czekają, PWA pokazuje „zbieracz offline od …”.
- Strony po 2–3 MB HTML → gzip i limit ciała 8 MB; większe odpowiedzi to błąd źródła.
