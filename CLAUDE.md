# Project Structure

Workspace root: /Users/andrzejimbirowycz/Code/imbiro

This is a monorepo. All packages live under `packages/`:

- `/Users/andrzejimbirowycz/Code/imbiro/packages/frontend-vue-pwa/` — Vue 3 PWA frontend
- `/Users/andrzejimbirowycz/Code/imbiro/packages/backend/` — backend service
- `/Users/andrzejimbirowycz/Code/imbiro/packages/shared/` — shared utilities

## CRITICAL: Production server

The production server (Hetzner, `ssh root@2.31.115.87`) is documented in
`/Users/andrzejimbirowycz/Code/imbiro/docs/SERVER.md`.

- Before doing anything on the server, READ `docs/SERVER.md` first — do not re-inventory the server from scratch.
- After ANY change on the server (packages, config, firewall, ports, containers, volumes, cron, `.env` keys, deploy scripts), UPDATE `docs/SERVER.md` in the same session: fix the relevant section, the "Ostatnia aktualizacja" date, and add a line to "Dziennik zmian".
- Never write secret values (passwords, keys) into `docs/SERVER.md` — only key names.
- Never read anything in `~/.ssh`.

## CRITICAL: File paths

ALWAYS use full absolute paths when creating or editing files. Never use paths starting with `/packages/` or relative paths.

Examples:
- frontend file → `/Users/andrzejimbirowycz/Code/imbiro/packages/frontend-vue-pwa/src/App.vue`
- backend file → `/Users/andrzejimbirowycz/Code/imbiro/packages/backend/src/index.ts`
- shared file → `/Users/andrzejimbirowycz/Code/imbiro/packages/shared/src/index.ts`
