# Domowy agent („domowe wyjście”)

Sklepy blokują IP serwera (centrum danych), a przepuszczają domowe. Agent działa w domu
(teraz laptop, docelowo serwis JS na TV z webOS) i daje serwerowi wyjście do internetu z domowego IP.

```
worker / Playwright ──CONNECT──► relay (Hetzner, sieć Dockera :3128)
                                   ▲  zlecenie „open x-kom.pl:443”
                                   │  (kanał sterujący, HTTPS /relay/agent/control, x-api-key)
                                 agent (dom) ──TCP──► sklep (widzi domowe IP)
```

- Agent **nie otwiera portów** — sam łączy się z serwerem (HTTPS, weryfikacja certyfikatu, `x-api-key`).
- Każde połączenie: osobny kanał danych `/relay/agent/data/<id>`; agent tylko przepycha bajty,
  TLS do sklepu jest po stronie serwera (agent nie widzi treści stron).
- Agent łączy się **wyłącznie z publicznymi IP na portach 80/443** (`ip-guard.js`) — serwer nie
  dostanie się przez niego do sieci domowej. Limit równoczesnych połączeń (64).
- Kod bez zależności i bez nowszej składni — ma działać na starym Node w TV.

## Uruchomienie

| | |
|---|---|
| lokalnie z całą aplikacją | `npm run dev` (startuje też `home-relay` na :3300/:3128 i agenta z tokenem deweloperskim) |
| laptop → produkcja | `npm run agent:prod` (czyta `packages/home-agent/config.prod.json`, wzór: `config.example.json`) |
| testy | `npm test --workspace=@myorg/home-agent` |

`config.json` / `config.prod.json` zawierają tajny token — są w `.gitignore` i nie trafiają na serwer.
Token = `HOME_AGENT_TOKEN` z `/opt/imbiro/.env`.

Diagnostyka na serwerze:

```bash
# stan agenta
ssh root@2.31.115.87 'cd /opt/imbiro && docker compose -f docker-compose.prod.yml exec -T relay wget -qO- http://127.0.0.1:3128/health'
# pobranie stron przez dom
ssh root@2.31.115.87 'cd /opt/imbiro && docker compose -f docker-compose.prod.yml exec -T relay node proxy-test.mjs https://www.x-kom.pl/'
```
