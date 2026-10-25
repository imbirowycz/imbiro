# imbiro

Monorepo: Vue 3 (Vite, PWA) + Express (TypeScript) + PostgreSQL + wspólny pakiet `@myorg/shared`. Kod frontendu: katalog `packages/frontend-vue-pwa` (pakiet npm `@myorg/frontend-vue-pwa`).

## Adresy i dostęp do bazy

| Usługa   | URL / host              | Uwagi                                      |
|----------|-------------------------|--------------------------------------------|
| Frontend | http://localhost:5173   | Vite w dev; w Dockerze statyczny `serve`   |
| Backend  | http://localhost:3000   | API `/api/auth/*`, `/api/scheduler/*` (po zalogowaniu), `/health` |
| Postgres | `localhost:5432`        | Użytkownik: `user`, hasło: `password`, baza: `app` |

## Pierwsze uruchomienie (zależności)

W katalogu głównym repozytorium:

```bash
npm install
```

## Pełny stack w Dockerze

Uruchomienie Postgresa, backendu i frontendu:

```bash
docker compose up -d --build
```

Albo z root `package.json`:

```bash
npm run docker:up
```

Zatrzymanie kontenerów:

```bash
docker compose down
# lub: npm run docker:down
```

Po zmianach w kodzie (np. po `git pull`):

```bash
docker compose up -d --build
```

## Development lokalny (bez pełnego stacku w Dockerze)

### Jednym poleceniem: włącz / wyłącz cały dev (Postgres + backend + frontend)

| Akcja | Polecenie |
|--------|-----------|
| **Start** | `npm run up` — uruchamia Postgres w Dockerze, czeka aż port `5432` będzie gotowy, potem `npm run dev` (Express + Vite z hot reload). |
| **Stop** | `npm run down` — zwalnia porty **3000** i **5173** (backend i Vite), potem `docker compose down` (m.in. Postgres). |

`npm run up` trzymaj w jednym terminalu; żeby skończyć pracę, w drugim terminalu (albo po **Ctrl+C** w pierwszym) możesz odpalić `npm run down`. **Ctrl+C** w terminalu z `up` kończy tylko procesy Node/Vite — wtedy Postgres nadal może działać w Dockerze; wtedy do gaszenia kontenerów użyj `npm run down`.

Typowy przepływ: Postgres w Dockerze, backend i frontend z Vite na hoście.

### Hot reload (zmiany od razu w dev)

| Część     | Jak działa |
|-----------|------------|
| **Frontend** | Vite — **HMR** (Hot Module Replacement): zapis `*.vue` / `*.ts` w `packages/frontend-vue-pwa` odświeża widok w przeglądarce bez pełnego przeładowania strony. |
| **Backend** | `tsx watch` — przy zapisie plików `.ts` w `packages/backend` (oraz importowanym kodzie z `packages/shared`) proces Express jest **ponownie uruchamiany** — to nie jest HMR w sensie „wstrzyknięcia” modułu, ale po 1–2 s masz już nową wersję API. |

**Kroki (ręcznie, bez `npm run up`):**

1. Baza (raz na sesję, dopóki kontener działa):

   ```bash
   docker compose up -d postgres
   ```

2. Backend + frontend z jednego terminala (w katalogu głównym repo):

   ```bash
   npm run dev
   ```

   Skrypt ustawia domyślne `DATABASE_URL=postgres://user:password@localhost:5432/app` (te same dane co w `docker-compose`). Otwórz **http://localhost:5173** — żądania `/api/*` idą przez proxy Vite na **http://localhost:3000**.

   Jeśli używasz innej bazy, nadpisz zmienną przed komendą, np.  
   `DATABASE_URL=postgres://... npm run dev` (Unix) albo ustaw ją w systemie / w `.env` i uruchom ręcznie oba workspaces.

### Sam backend bez Dockera

Ustaw `DATABASE_URL` (np. gdy Postgres działa lokalnie lub przez `docker compose` jak wyżej):

```bash
DATABASE_URL=postgres://user:password@localhost:5432/app npm run dev --workspace=@myorg/backend
```

### Sam frontend

```bash
npm run dev --workspace=@myorg/frontend-vue-pwa
```

Bez backendu żądania do API zwrócą błędy; proxy `/api` działa, gdy backend nasłuchuje na porcie 3000.

## Migracje bazy danych

Pliki SQL w `packages/backend/migrations/` (`NNN_nazwa.sql`) są wykonywane automatycznie przy starcie backendu, w kolejności nazw, każdy w osobnej transakcji. Wykonane migracje są zapisywane w tabeli `schema_migrations`; równoległe starty (backend + worker) chroni `pg_advisory_lock`. Nowa zmiana schematu = nowy plik z kolejnym numerem — nie edytuj już wykonanych.

## Scheduler — wykonanie zadań

Kod: `packages/backend/src/modules/scheduler/`. Planowanie i wykonanie idzie przez kolejkę pg-boss `scheduler.execute`, obsługiwaną przez osobny proces `worker` (`src/worker.ts`).

REST API (`/api/scheduler`, błędy w formacie `{ error, details? }`):

| Metoda i ścieżka | Opis | Kody |
|---|---|---|
| `GET /tasks` | lista zadań | 200 |
| `POST /tasks` | utworzenie zadania | 201 (+ `Location`), 400 |
| `GET /tasks/:id` | szczegóły | 200, 404 |
| `PATCH /tasks/:id` | edycja (dowolny podzbiór pól) | 200, 400, 404 |
| `POST /tasks/:id/enable` | aktywacja | 200, 404, 409 (brak przyszłego terminu) |
| `POST /tasks/:id/disable` | dezaktywacja | 200, 404 |
| `POST /tasks/:id/run` | ręczne uruchomienie (ta sama kolejka i executor) | 202, 404 |
| `GET /tasks/:id/executions?limit=50` | historia wykonań (najnowsze pierwsze, `limit` 1–200) | 200, 400, 404 |
| `GET /actions` | dostępne typy akcji | 200 |

Przykład (API wymaga sesji — najpierw logowanie, potem cookie i nagłówek `X-CSRF-Token`):

```bash
CSRF=$(curl -s -c /tmp/imbiro.cookies -X POST localhost:3000/api/auth/login -H 'Content-Type: application/json' \
  -d '{"login":"admin","password":"…"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).csrfToken')
curl -b /tmp/imbiro.cookies -H "X-CSRF-Token: $CSRF" -X POST localhost:3000/api/scheduler/tasks -H 'Content-Type: application/json' -d '{
  "title": "Raport dzienny", "actionType": "report.generate", "actionConfig": { "periodHours": 24 },
  "scheduleType": "cron", "scheduleConfig": { "expression": "0 8 * * *" }, "timezone": "Europe/Warsaw"
}'
```

Typy harmonogramu: `once` (termin = `startAt`), `cron` (`{ "expression": "<5 pól>" }`, liczony w `timezone`), `interval` (`{ "everySeconds": 1800 }`, min. 60). Opcjonalnie `startAt` / `endAt` (ISO 8601 z offsetem) i `enabled`.

- **Jeden termin = jedno wykonanie.** Rekord w `task_executions` ma unikalny `(task_id, scheduled_for)`; drugi job dla tego samego terminu jest pomijany.
- **Statusy:** `pending` (czeka na start lub na ponowienie po błędzie) → `running` → `succeeded` / `failed`.
- **Timeout i ponowienia:** `JOB_TIMEOUT_SECONDS` na próbę, do `JOB_RETRY_LIMIT` ponowień z wykładniczym backoff (`JOB_RETRY_DELAY_SECONDS` … `JOB_RETRY_DELAY_MAX_SECONDS`). Błędy trwałe (brak konfiguracji integracji, zła konfiguracja akcji, odrzucony adresat) kończą wykonanie od razu.
- **Awaria workera:** job przerwanej próby wygasa (timeout + 60 s) i pg-boss ponawia go — kolejna próba przejmuje to samo wykonanie. Wykonanie, którego job zakończył się bez zapisu wyniku, reconcile (co minutę) oznacza jako `failed`.
- **Pominięte terminy** (np. worker wyłączony) nie są nadrabiane: zaległy termin wykona się raz, następny liczony jest od teraz.
- **Brak gwarancji exactly-once dla operacji zewnętrznych.** Gwarancja to „co najmniej raz”: jeśli worker padnie po wysłaniu emaila, a przed zapisem wyniku, ponowienie wyśle go jeszcze raz. Akcje dostają stały `executionId` jako klucz idempotencji (np. `email.send` używa go jako `Message-ID`).

## Logowanie i bezpieczeństwo

Aplikacja ma jedno konto administratora, bez rejestracji i odzyskiwania hasła. Wszystkie endpointy `/api/*` poza `/api/auth/*` wymagają zalogowania (inaczej `401`).

| Endpoint | Opis |
|---|---|
| `POST /api/auth/login` | `{ "login": "<login lub e-mail>", "password": "…" }` → ustawia cookie sesji, zwraca `{ user, csrfToken, expiresAt }` |
| `GET /api/auth/me` | bieżąca sesja (`200`) albo `401` |
| `POST /api/auth/logout` | unieważnia sesję w bazie (`204`) |

**Inicjalizacja administratora.** Dane są tylko w zmiennych środowiskowych, hasło wyłącznie jako hash Argon2id:

```bash
# lokalnie — wypisze linię ADMIN_PASSWORD_HASH='…' (hasło wpisujesz bez echa)
npm run admin:hash --workspace=@myorg/backend
```

Lokalnie wpisz `ADMIN_USERNAME` i tę linię do `packages/backend/.env` (plik w `.gitignore`; czytają go `npm run dev` i lokalny `docker compose`). Na serwerze — do `/opt/imbiro/.env` (instrukcja w `.env.example`). Zmiana hasła = nowy hash w `.env` + restart backendu; istniejące sesje pozostają ważne do wygaśnięcia (żeby wylogować wszystkich od razu: `DELETE FROM admin_sessions`).

**Zmienne środowiskowe backendu (auth):**

| Zmienna | Wymagana | Domyślnie | Opis |
|---|---|---|---|
| `ADMIN_USERNAME` | tak | — | login administratora |
| `ADMIN_EMAIL` | nie | — | alternatywny login |
| `ADMIN_PASSWORD_HASH` | tak | — | hash Argon2id (`npm run admin:hash`) |
| `SESSION_TTL_HOURS` | nie | `12` | bezwzględny czas życia sesji |
| `SESSION_IDLE_MINUTES` | nie | `120` | wygaśnięcie po bezczynności |
| `SESSION_COOKIE_SECURE` | nie | `true` w produkcji | cookie tylko przez HTTPS (`__Host-imbiro_session`) |
| `TRUST_PROXY` | nie | `0` | liczba reverse proxy przed API (za Caddy: `1`) — źródło IP do limitów logowania |
| `CORS_ORIGINS` | nie | dev: `http://localhost:5173`, prod: brak | originy frontendu spoza adresu API (lista po przecinku) |
| `LOGIN_WINDOW_MINUTES` | nie | `15` | okno limitów logowania |
| `LOGIN_MAX_FAILURES_PER_IP_LOGIN` / `_PER_IP` / `_PER_LOGIN` | nie | `5` / `20` / `50` | nieudane próby w oknie, po których jest `429` |

**Jak chronione są dane:**
- sesja w PostgreSQL (`admin_sessions`), w cookie losowy token (`HttpOnly`, `SameSite=Lax`, `Secure` w produkcji), w bazie tylko jego SHA-256; sprawdzana przy każdym żądaniu, usuwana przy wylogowaniu;
- CSRF: operacje zmieniające stan wymagają nagłówka `X-CSRF-Token` z tokenem sesji, a żądania z obcym `Origin` są odrzucane (`403`); logowanie przyjmuje tylko JSON;
- brute-force: limity nieudanych prób w PostgreSQL (`login_attempts`), po przekroczeniu `429` z `Retry-After`; komunikaty błędów są ogólne, czas odpowiedzi nie zdradza, czy login istnieje;
- logi nie zawierają haseł, tokenów ani loginów z nieudanych prób;
- w produkcji Caddy zapewnia HTTPS i nagłówki bezpieczeństwa (HSTS, CSP, `X-Frame-Options`, `nosniff`).

## Build produkcyjny (artyfakty lokalne)

```bash
npm run build
```

Kolejność: `@myorg/shared` → `@myorg/backend` → `@myorg/frontend-vue-pwa`.

## Frontend w obrazie Dockera

Przy budowaniu obrazu frontendu ustawiane jest `VITE_API_BASE_URL=http://localhost:3000`, żeby przeglądarka na hoście wołała API pod portem 3000 (statyczny serwer nie ma proxy jak Vite w dev).
