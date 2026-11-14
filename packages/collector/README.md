# Zbieracz (collector)

Mały program uruchamiany **w domu** (na razie Mac, docelowo stary laptop z Linuxem).
Pobiera strony sklepów z domowego IP i odsyła je do głównego API na Hetznerze —
z serwera sklepy blokują takie zapytania.

Zbieracz niczego nie planuje i niczego nie pamięta:

1. pyta API „co pobrać?” (`POST /api/collector/claim`) — dostaje listę adresów **i limity**
   (co ile pytać, odstęp między stronami jednej domeny, limit czasu strony, ile zadań naraz),
2. otwiera każdą stronę w prawdziwym Chromie (z oknem i stałym profilem),
3. odsyła HTML i kod odpowiedzi (`POST /api/collector/results`).

W ciszy nocnej (domyślnie 22:00–5:00, ustawiana na serwerze) API odpowiada „nic do zrobienia,
wróć o 5:00” — zbieracz śpi do tej godziny i w ogóle nie odpytuje serwera.

Harmonogram, wyciąganie ceny, historia, okazje i powiadomienia są po stronie serwera
(`packages/backend/src/modules/prices`). Limity zmienia się w `.env` serwera
(`COLLECTOR_*`), nie tutaj.

## Konfiguracja

Skopiuj `.env.example` do `.env` w tym katalogu:

| Klucz | Znaczenie |
|---|---|
| `API_URL` | adres głównego API, np. `https://2.31.115.87.sslip.io` (lokalnie `http://localhost:3000`) |
| `COLLECTOR_TOKEN` | ten sam sekret co `COLLECTOR_TOKEN` w `.env` serwera |
| `PROFILE_DIR` | opcjonalnie: katalog profilu Chrome (domyślnie `./.profile`) |
| `BROWSER_CHANNEL` | opcjonalnie: `chrome` (domyślnie), `chromium`, `msedge` |
| `HEADLESS` | opcjonalnie: `true` = bez okna. Większość sklepów blokuje taki tryb — zostaw `false` |

Przeniesienie na inny komputer = skopiowanie repo i podmiana `.env`.

## Uruchomienie na Macu

Wymagane: Node 22+, zainstalowany Google Chrome.

```bash
# z katalogu repo
npm install
npm run start --workspace=@myorg/collector
```

Otworzy się okno Chrome'a (osobny profil, nie Twój codzienny) — zostaw je w tle.
Zatrzymanie: `Ctrl+C`.

Żeby zbieracz działał po zamknięciu terminala:

```bash
nohup npm run start --workspace=@myorg/collector > packages/collector/collector.log 2>&1 &
```

Mac nie może wtedy zasnąć (uśpiony = zbieracz offline; zadania czekają w kolejce na serwerze).

## Instalacja na Linuxie (docelowo)

```bash
# Node 22, Chrome i wirtualny ekran (laptop bez monitora / z zamkniętą klapą)
sudo apt install -y xvfb
wget https://dl.google.com/linux/direct/google-chrome-stable_current_amd64.deb
sudo apt install -y ./google-chrome-stable_current_amd64.deb

git clone <repo> ~/imbiro && cd ~/imbiro
npm install
cp packages/collector/.env.example packages/collector/.env   # uzupełnij API_URL i COLLECTOR_TOKEN
```

Usługa systemd (`/etc/systemd/system/imbiro-collector.service`, podmień użytkownika):

```ini
[Unit]
Description=imbiro collector
After=network-online.target
Wants=network-online.target

[Service]
User=andrzej
WorkingDirectory=/home/andrzej/imbiro
ExecStart=/usr/bin/xvfb-run -a --server-args="-screen 0 1920x1080x24" /usr/bin/npm run start --workspace=@myorg/collector
Restart=always
RestartSec=15

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable --now imbiro-collector
journalctl -u imbiro-collector -f
```

Wyłącz usypianie po zamknięciu klapy: w `/etc/systemd/logind.conf` ustaw
`HandleLidSwitch=ignore` i wykonaj `sudo systemctl restart systemd-logind`.

## Bezpieczeństwo

- Zbieracz łączy się tylko **wychodząco** — w domowej sieci nie otwiera się żadnych portów.
- Otwiera wyłącznie adresy `https` wskazujące na publiczne IP; adresy sieci domowej
  (192.168.x.x, 10.x.x.x, localhost itd.) odrzuca, także po przekierowaniu
  (`src/ip-guard.ts`). Dzięki temu przejęcie tokenu nie daje dostępu do routera czy NAS-a.
- Profil Chrome (`.profile`) zawiera ciasteczka sklepów — nie trafia do repo.

## Testy

```bash
npm test --workspace=@myorg/collector
```
