# imbiro

Monorepo: Vue 3 (Vite, PWA) + Express (TypeScript) + PostgreSQL + wspólny pakiet `@myorg/shared`. Kod frontendu: katalog `packages/frontend-vue-pwa` (pakiet npm `@myorg/frontend-vue-pwa`).

## Adresy i dostęp do bazy

| Usługa   | URL / host              | Uwagi                                      |
|----------|-------------------------|--------------------------------------------|
| Frontend | http://localhost:5173   | Vite w dev; w Dockerze statyczny `serve`   |
| Backend  | http://localhost:3000   | API m.in. `GET/POST /api/users`, `/health` |
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

## Build produkcyjny (artyfakty lokalne)

```bash
npm run build
```

Kolejność: `@myorg/shared` → `@myorg/backend` → `@myorg/frontend-vue-pwa`.

## Frontend w obrazie Dockera

Przy budowaniu obrazu frontendu ustawiane jest `VITE_API_BASE_URL=http://localhost:3000`, żeby przeglądarka na hoście wołała API pod portem 3000 (statyczny serwer nie ma proxy jak Vite w dev).
