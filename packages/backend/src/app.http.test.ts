import assert from 'node:assert/strict'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, describe, it } from 'node:test'
import argon2 from 'argon2'
import { z } from 'zod'
import { createApp } from './app'
import type { PgBoss } from 'pg-boss'
import { composeApi } from './composition'
import { NotFoundError, ValidationError } from './core/errors'
import type { LoginLimiter } from './modules/auth/login-limiter'
import type { AuthSession, SessionRepository } from './modules/auth/session.repository'
import { ModuleRunner } from './modules/radar/core/module.runner'
import { defineModule } from './modules/radar/core/module.types'
import type { HttpClient } from './modules/radar/http/safe-fetch'
import { createRadarRegistry } from './modules/radar/radar.catalog'
import type { ReadItemsRepository, ReadMark } from './modules/radar/read-items.repository'
import { ReaderBusyError, type ArticleReader } from './modules/radar/reader/article-reader'
import type { SchedulerService } from './modules/scheduler/scheduler.service'

// Characterization tests of the HTTP contract: status codes, headers and the error format of
// every route, with the database and external sources replaced by in-memory fakes.
// They pin the behaviour the frontend relies on, so refactoring cannot change it unnoticed.

const PASSWORD = 'correct horse battery staple'
const TASK_ID = '11111111-1111-4111-8111-111111111111'

function fakeSessions() {
  const sessions = new Map<string, AuthSession>()
  let counter = 0
  return {
    sessions,
    async create() {
      const token = `token-${++counter}`
      const session: AuthSession = { id: `id-${counter}`, csrfToken: `csrf-${counter}`, createdAt: new Date(), expiresAt: new Date(Date.now() + 3600_000) }
      sessions.set(token, session)
      return { token, session }
    },
    async findActive(token: string) {
      return sessions.get(token) ?? null
    },
    async deleteByToken(token: string) {
      sessions.delete(token)
    },
    async deleteExpired() {
      return 0
    },
  }
}

function fakeLimiter() {
  const state = { blocked: false, recorded: [] as boolean[] }
  return {
    state,
    async check() {
      return state.blocked ? ({ allowed: false, retryAfterSeconds: 42 } as const) : ({ allowed: true } as const)
    },
    async record(_ip: string, _identifier: string, succeeded: boolean) {
      state.recorded.push(succeeded)
    },
    async deleteOld() {
      return 0
    },
  }
}

function fakeScheduler() {
  const calls: unknown[][] = []
  const task = { id: TASK_ID, title: 'Task' }
  const known = (id: string) => {
    if (id !== TASK_ID) throw new NotFoundError(`Task ${id} not found`)
  }
  return {
    calls,
    async list() {
      return [task]
    },
    async get(id: string) {
      known(id)
      return task
    },
    async create(input: unknown) {
      calls.push(['create', input])
      if (!(input as { title?: string }).title) {
        throw new ValidationError('Invalid task definition', [{ path: 'title', message: 'Required' }])
      }
      return task
    },
    async update(id: string, input: unknown) {
      known(id)
      calls.push(['update', id, input])
      return task
    },
    async enable(id: string) {
      known(id)
      return { ...task, enabled: true }
    },
    async disable(id: string) {
      known(id)
      return { ...task, enabled: false }
    },
    async runNow(id: string) {
      known(id)
      return { id: 'exec-1', taskId: id, status: 'pending' }
    },
    async listExecutions(id: string, limit: number) {
      known(id)
      calls.push(['listExecutions', id, limit])
      return []
    },
  }
}

function fakeReadItems() {
  const marks = new Map<string, ReadMark>()
  const store: ReadItemsRepository = {
    async listKeys() {
      return [...marks.keys()]
    },
    async markRead(mark: ReadMark) {
      marks.set(mark.key, mark)
    },
    async markManyRead(many: ReadMark[]) {
      for (const mark of many) marks.set(mark.key, mark)
    },
    async unmarkRead(key: string) {
      marks.delete(key)
    },
    async unmarkManyRead(keys: string[]) {
      for (const key of keys) marks.delete(key)
    },
    async deleteExpired() {
      return 0
    },
  }
  return { marks, store }
}

/** The real catalog (the dashboard layout refers to its groups) plus two offline test modules. */
function fakeRadar() {
  const registry = createRadarRegistry()
    .register(
      defineModule({
        id: 'test.numbers',
        name: 'Numbers',
        group: 'news',
        description: 'Test module',
        source: { name: 'Test', homepage: 'https://example.test' },
        itemKind: null,
        kind: 'collector',
        allowedHosts: ['example.test'],
        itemSchema: z.object({ n: z.number() }),
        cacheTtlSeconds: 60,
        execute: async () => ({ data: [{ n: 1 }, { n: 2 }] }),
      })
    )
    .register(
      defineModule({
        id: 'test.broken',
        name: 'Broken',
        group: 'news',
        description: 'Always fails',
        source: { name: 'Test', homepage: 'https://example.test' },
        itemKind: null,
        kind: 'collector',
        allowedHosts: ['example.test'],
        itemSchema: z.object({ n: z.number() }),
        cacheTtlSeconds: 60,
        execute: async () => {
          throw new Error('boom')
        },
      })
    )
    .defineGroup({ id: 'test', name: 'Test', description: 'Test group', moduleIds: ['test.numbers', 'test.broken'] })
    .validate()
  // Only the test modules may run here — no test reaches a real source.
  const runner = new ModuleRunner(registry, {
    httpFactory: () =>
      new Proxy({} as HttpClient, {
        get: () => () => Promise.reject(new Error('HTTP is not available in tests')),
      }),
  })
  const readerState = { busy: false }
  const reader = {
    domains: ['example.test'],
    async read(url: string) {
      if (readerState.busy) throw new ReaderBusyError()
      return { url, title: 'Article' }
    },
  } as unknown as ArticleReader
  const readItems = fakeReadItems()
  return { registry, runner, reader, readerState, readItems }
}

describe('HTTP API contract', () => {
  const sessions = fakeSessions()
  const limiter = fakeLimiter()
  const scheduler = fakeScheduler()
  const radar = fakeRadar()
  let server: Server
  let base: string
  let cookie = ''
  let csrf = ''

  type Init = { method?: string; body?: unknown; headers?: Record<string, string>; raw?: string; anonymous?: boolean; noCsrf?: boolean }

  async function call(path: string, init: Init = {}) {
    const headers: Record<string, string> = { ...init.headers }
    if (!init.anonymous && cookie) headers.cookie = cookie
    if (!init.anonymous && !init.noCsrf && csrf) headers['x-csrf-token'] = csrf
    let body: string | undefined
    if (init.raw !== undefined) body = init.raw
    else if (init.body !== undefined) body = JSON.stringify(init.body)
    if (body !== undefined) headers['content-type'] ??= 'application/json'
    const response = await fetch(base + path, { method: init.method ?? 'GET', headers, body })
    const text = await response.text()
    return { status: response.status, headers: response.headers, json: text ? JSON.parse(text) : undefined }
  }

  before(async () => {
    process.env.ADMIN_PASSWORD_HASH = await argon2.hash(PASSWORD, { type: argon2.argon2id })
    const app = createApp({
      scheduler: scheduler as unknown as SchedulerService,
      // The real action list, as wired for the application.
      actions: composeApi({} as PgBoss).actions,
      sessions: sessions as unknown as SessionRepository,
      loginLimiter: limiter as unknown as LoginLimiter,
      radar: { registry: radar.registry, runner: radar.runner, reader: radar.reader, readItems: radar.readItems.store },
    })
    server = app.listen(0, '127.0.0.1')
    await new Promise((resolve) => server.once('listening', resolve))
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  })

  after(async () => {
    await new Promise((resolve) => server.close(resolve))
  })

  describe('without a session', () => {
    it('serves /health without the API middleware', async () => {
      const res = await call('/health', { anonymous: true })
      assert.equal(res.status, 200)
      assert.deepEqual(res.json, { ok: true })
      assert.equal(res.headers.get('cache-control'), null)
      assert.equal(res.headers.get('x-powered-by'), null)
    })

    it('answers 401 for every /api path, existing or not', async () => {
      for (const path of ['/api/scheduler/tasks', '/api/radar/dashboard', '/api/auth/me', '/api/nope']) {
        const res = await call(path, { anonymous: true })
        assert.equal(res.status, 401, path)
        assert.deepEqual(res.json, { error: 'Authentication required' }, path)
        assert.equal(res.headers.get('cache-control'), 'no-store', path)
      }
    })

    it('answers 404 in the common error format outside /api', async () => {
      const res = await call('/nope', { anonymous: true })
      assert.equal(res.status, 404)
      assert.deepEqual(res.json, { error: 'Route GET /nope not found' })
    })

    it('rejects state-changing requests from a foreign origin', async () => {
      const res = await call('/api/auth/login', { anonymous: true, method: 'POST', body: {}, headers: { origin: 'https://evil.test' } })
      assert.equal(res.status, 403)
      assert.deepEqual(res.json, { error: 'Origin not allowed' })
    })

    it('answers CORS preflight only for the allowed frontend origin', async () => {
      const allowed = await call('/api/auth/login', {
        anonymous: true,
        method: 'OPTIONS',
        headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'POST' },
      })
      assert.equal(allowed.status, 204)
      assert.equal(allowed.headers.get('access-control-allow-origin'), 'http://localhost:5173')
      assert.equal(allowed.headers.get('access-control-allow-credentials'), 'true')
      assert.equal(allowed.headers.get('access-control-allow-headers'), 'Content-Type,X-CSRF-Token')

      const foreign = await call('/api/auth/login', {
        anonymous: true,
        method: 'OPTIONS',
        headers: { origin: 'https://evil.test', 'access-control-request-method': 'POST' },
      })
      assert.equal(foreign.headers.get('access-control-allow-origin'), null)
    })

    it('reports malformed and oversized JSON bodies', async () => {
      const malformed = await call('/api/auth/login', { anonymous: true, method: 'POST', raw: '{nope' })
      assert.equal(malformed.status, 400)
      assert.deepEqual(malformed.json, { error: 'Malformed JSON body' })

      const large = await call('/api/auth/login', { anonymous: true, method: 'POST', raw: JSON.stringify({ login: 'x'.repeat(1_100_000) }) })
      assert.equal(large.status, 413)
      assert.deepEqual(large.json, { error: 'Request body too large' })
    })
  })

  describe('login', () => {
    it('accepts only JSON with a login and a password', async () => {
      const form = await call('/api/auth/login', { anonymous: true, method: 'POST', raw: 'login=a', headers: { 'content-type': 'application/x-www-form-urlencoded' } })
      assert.equal(form.status, 415)
      assert.deepEqual(form.json, { error: 'Content-Type must be application/json' })

      const empty = await call('/api/auth/login', { anonymous: true, method: 'POST', body: { login: 'admin' } })
      assert.equal(empty.status, 400)
      assert.deepEqual(empty.json, { error: 'Login and password are required' })
    })

    it('answers 401 with one message for a wrong login and a wrong password', async () => {
      limiter.state.recorded.length = 0
      for (const body of [{ login: 'admin', password: 'wrong' }, { login: 'nobody', password: PASSWORD }]) {
        const res = await call('/api/auth/login', { anonymous: true, method: 'POST', body })
        assert.equal(res.status, 401)
        assert.deepEqual(res.json, { error: 'Invalid login or password' })
      }
      assert.deepEqual(limiter.state.recorded, [false, false])
    })

    it('answers 429 with Retry-After when the limiter blocks', async () => {
      limiter.state.blocked = true
      const res = await call('/api/auth/login', { anonymous: true, method: 'POST', body: { login: 'admin', password: PASSWORD } })
      limiter.state.blocked = false
      assert.equal(res.status, 429)
      assert.equal(res.headers.get('retry-after'), '42')
      assert.deepEqual(res.json, { error: 'Too many login attempts. Try again later.' })
    })

    it('logs in by username or e-mail, sets the session cookie and returns the CSRF token', async () => {
      const byEmail = await call('/api/auth/login', { anonymous: true, method: 'POST', body: { login: ' Admin@Example.Test ', password: PASSWORD } })
      assert.equal(byEmail.status, 200)

      const res = await call('/api/auth/login', { anonymous: true, method: 'POST', body: { login: 'ADMIN', password: PASSWORD } })
      assert.equal(res.status, 200)
      assert.deepEqual(Object.keys(res.json).sort(), ['csrfToken', 'expiresAt', 'user'])
      assert.deepEqual(res.json.user, { username: 'admin', email: 'admin@example.test' })

      const setCookie = res.headers.get('set-cookie') ?? ''
      assert.match(setCookie, /^imbiro_session=token-\d+; Path=\/; Expires=[^;]+; HttpOnly; SameSite=Lax$/)
      cookie = setCookie.split(';')[0]
      csrf = res.json.csrfToken
    })

    it('replaces the previous session of the same browser on a new login', async () => {
      const before = sessions.sessions.size
      const res = await call('/api/auth/login', { method: 'POST', body: { login: 'admin', password: PASSWORD } })
      assert.equal(res.status, 200)
      assert.equal(sessions.sessions.size, before)
      cookie = (res.headers.get('set-cookie') ?? '').split(';')[0]
      csrf = res.json.csrfToken
    })
  })

  describe('with a session', () => {
    it('returns the session on /me', async () => {
      const res = await call('/api/auth/me')
      assert.equal(res.status, 200)
      assert.equal(res.json.csrfToken, csrf)
    })

    it('requires the CSRF token for state-changing requests only', async () => {
      assert.equal((await call('/api/scheduler/tasks', { noCsrf: true })).status, 200)
      for (const [method, path] of [['POST', '/api/scheduler/tasks'], ['POST', '/api/radar/run'], ['DELETE', '/api/radar/read-items?key=news:https://a.test/x'], ['POST', '/api/auth/logout']]) {
        const res = await call(path, { method, body: method === 'POST' ? {} : undefined, noCsrf: true })
        assert.equal(res.status, 403, `${method} ${path}`)
        assert.deepEqual(res.json, { error: 'Invalid or missing CSRF token' })
      }
      const wrong = await call('/api/scheduler/tasks', { method: 'POST', body: {}, noCsrf: true, headers: { 'x-csrf-token': 'nope' } })
      assert.equal(wrong.status, 403)
    })

    it('answers 404 for unknown /api routes', async () => {
      const res = await call('/api/nope')
      assert.equal(res.status, 404)
      assert.deepEqual(res.json, { error: 'Route GET /api/nope not found' })
    })

    it('clears a cookie that no longer matches a session', async () => {
      const res = await call('/api/auth/me', { anonymous: true, headers: { cookie: 'imbiro_session=gone' } })
      assert.equal(res.status, 401)
      assert.match(res.headers.get('set-cookie') ?? '', /^imbiro_session=; Path=\/; Expires=Thu, 01 Jan 1970/)
    })
  })

  describe('scheduler routes', () => {
    it('lists actions and tasks', async () => {
      const actions = await call('/api/scheduler/actions')
      assert.equal(actions.status, 200)
      assert.deepEqual(actions.json.map((a: { type: string }) => a.type), ['email.send', 'telegram.send', 'report.generate', 'radar.deliver', 'db.cleanup'])
      assert.deepEqual(Object.keys(actions.json[0]), ['type', 'description'])

      const tasks = await call('/api/scheduler/tasks')
      assert.deepEqual(tasks.json, [{ id: TASK_ID, title: 'Task' }])
    })

    it('creates a task with 201 and a Location header, passing the body through unchanged', async () => {
      const res = await call('/api/scheduler/tasks', { method: 'POST', body: { title: 'New', extra: 1 } })
      assert.equal(res.status, 201)
      assert.equal(res.headers.get('location'), `/api/scheduler/tasks/${TASK_ID}`)
      assert.deepEqual(scheduler.calls.at(-1), ['create', { title: 'New', extra: 1 }])
    })

    it('returns validation errors as 400 with details', async () => {
      const res = await call('/api/scheduler/tasks', { method: 'POST', body: {} })
      assert.equal(res.status, 400)
      assert.deepEqual(res.json, { error: 'Invalid task definition', details: [{ path: 'title', message: 'Required' }] })
    })

    it('reads, updates, enables and disables a task', async () => {
      assert.equal((await call(`/api/scheduler/tasks/${TASK_ID}`)).status, 200)
      const patched = await call(`/api/scheduler/tasks/${TASK_ID}`, { method: 'PATCH', body: { title: 'X' } })
      assert.equal(patched.status, 200)
      assert.deepEqual(scheduler.calls.at(-1), ['update', TASK_ID, { title: 'X' }])
      assert.equal((await call(`/api/scheduler/tasks/${TASK_ID}/enable`, { method: 'POST' })).json.enabled, true)
      assert.equal((await call(`/api/scheduler/tasks/${TASK_ID}/disable`, { method: 'POST' })).json.enabled, false)
    })

    it('answers 404 for an unknown task', async () => {
      const res = await call('/api/scheduler/tasks/unknown')
      assert.equal(res.status, 404)
      assert.deepEqual(res.json, { error: 'Task unknown not found' })
    })

    it('queues a manual run with 202 and a Location header', async () => {
      const res = await call(`/api/scheduler/tasks/${TASK_ID}/run`, { method: 'POST' })
      assert.equal(res.status, 202)
      assert.equal(res.headers.get('location'), `/api/scheduler/tasks/${TASK_ID}/executions`)
      assert.deepEqual(res.json, { id: 'exec-1', taskId: TASK_ID, status: 'pending' })
    })

    it('validates the executions limit (default 50, 1..200)', async () => {
      await call(`/api/scheduler/tasks/${TASK_ID}/executions`)
      assert.deepEqual(scheduler.calls.at(-1), ['listExecutions', TASK_ID, 50])
      await call(`/api/scheduler/tasks/${TASK_ID}/executions?limit=200`)
      assert.deepEqual(scheduler.calls.at(-1), ['listExecutions', TASK_ID, 200])
      for (const limit of ['0', '201', '1.5', 'abc', '']) {
        const res = await call(`/api/scheduler/tasks/${TASK_ID}/executions?limit=${limit}`)
        assert.equal(res.status, 400, limit)
        assert.deepEqual(res.json, { error: 'Invalid query', details: [{ path: 'limit', message: 'Must be an integer between 1 and 200' }] })
      }
    })
  })

  describe('radar routes', () => {
    it('lists modules and groups', async () => {
      const modules = await call('/api/radar/modules')
      const ids: string[] = modules.json.map((m: { id: string }) => m.id)
      assert.deepEqual(ids.slice(-2), ['test.numbers', 'test.broken'])
      assert.ok(ids.includes('finance.nbp.currencies') && ids.includes('morning.overview'), ids.join(', '))
      assert.deepEqual(Object.keys(modules.json[0]), ['id', 'name', 'group', 'category', 'description', 'source', 'itemKind', 'kind'])
      const groups = await call('/api/radar/groups')
      assert.deepEqual(groups.json.at(-1), { id: 'test', name: 'Test', description: 'Test group', moduleIds: ['test.numbers', 'test.broken'] })
      assert.deepEqual(
        groups.json.map((g: { id: string }) => g.id),
        ['finance', 'news.poland', 'news.world', 'news.warsaw', 'news.economy', 'news.it', 'news.security', 'news.health', 'news', 'weather', 'alerts', 'test']
      )
    })

    it('runs a module: a source failure is a 200 with status "error", not an API error', async () => {
      const ok = await call('/api/radar/modules/test.numbers/run', { method: 'POST' })
      assert.equal(ok.status, 200)
      assert.equal(ok.json.status, 'success')
      assert.deepEqual(ok.json.data, [{ n: 1 }, { n: 2 }])
      assert.deepEqual(Object.keys(ok.json).sort(), ['cached', 'data', 'dataAsOf', 'durationMs', 'error', 'fetchedAt', 'group', 'itemKind', 'moduleId', 'source', 'stale', 'status', 'warnings'])

      const failed = await call('/api/radar/modules/test.broken/run', { method: 'POST', body: { force: false } })
      assert.equal(failed.status, 200)
      assert.equal(failed.json.status, 'error')
      assert.deepEqual(failed.json.error, { code: 'INTERNAL', message: 'Nieoczekiwany błąd modułu' })
    })

    it('runs a group and an explicit list of modules', async () => {
      const group = await call('/api/radar/groups/test/run', { method: 'POST' })
      assert.equal(group.status, 200)
      assert.equal(group.json.status, 'partial')
      assert.deepEqual(group.json.target, { kind: 'group', id: 'test' })
      assert.equal(group.json.results.length, 2)

      const many = await call('/api/radar/run', { method: 'POST', body: { moduleIds: ['test.numbers'] } })
      assert.equal(many.status, 200)
      assert.deepEqual(many.json.target, { kind: 'modules', ids: ['test.numbers'] })
      assert.equal(many.json.results[0].cached, true)
    })

    it('reports unknown modules, groups and invalid bodies', async () => {
      const module = await call('/api/radar/modules/nope.nope/run', { method: 'POST' })
      assert.equal(module.status, 404)
      assert.deepEqual(module.json, { error: 'Radar module nope.nope not found' })

      const group = await call('/api/radar/groups/nope/run', { method: 'POST' })
      assert.equal(group.status, 404)
      assert.deepEqual(group.json, { error: 'Radar group nope not found' })

      const unknown = await call('/api/radar/run', { method: 'POST', body: { moduleIds: ['test.numbers', 'nope.nope'] } })
      assert.equal(unknown.status, 400)
      assert.deepEqual(unknown.json, { error: 'Invalid request', details: [{ path: 'moduleIds.1', message: 'Unknown module' }] })

      const extra = await call('/api/radar/modules/test.numbers/run', { method: 'POST', body: { force: 'yes', other: 1 } })
      assert.equal(extra.status, 400)
      assert.equal(extra.json.error, 'Invalid request')
      assert.deepEqual(extra.json.details.map((d: { path: string }) => d.path).sort(), ['(root)', 'force'])
    })

    it('returns the dashboard layout with cached results and read keys', async () => {
      const res = await call('/api/radar/dashboard')
      assert.equal(res.status, 200)
      assert.deepEqual(Object.keys(res.json).sort(), ['generatedAt', 'readKeys', 'readerDomains', 'sections'])
      assert.deepEqual(res.json.readerDomains, ['example.test'])
      assert.deepEqual(
        res.json.sections.map((s: { id: string; page: string }) => `${s.page}/${s.id}`),
        ['home/poland', 'home/world', 'home/warsaw', 'home/it', 'home/health', 'home/alerts', 'weather/weather', 'weather/finance']
      )
      const finance = res.json.sections.at(-1)
      assert.deepEqual(Object.keys(finance).sort(), ['id', 'moduleIds', 'page', 'results', 'title'])
      assert.deepEqual(finance.moduleIds, ['finance.nbp.currencies', 'finance.nbp.gold'])
      assert.deepEqual(finance.results, [null, null])
    })

    it('marks and unmarks read items', async () => {
      const marked = await call('/api/radar/read-items', { method: 'POST', body: { kind: 'news', url: 'https://a.test/x?utm_source=rss#frag', title: 'T' } })
      assert.equal(marked.status, 204)
      assert.deepEqual([...radar.readItems.marks.keys()], ['news:https://a.test/x'])

      const batch = await call('/api/radar/read-items/batch', {
        method: 'POST',
        body: { items: [{ kind: 'news', url: 'https://a.test/y' }, { kind: 'alert', id: 'imgw:1', issuedAt: '2026-11-01T10:00:00Z' }] },
      })
      assert.equal(batch.status, 200)
      assert.equal(batch.json.keys.length, 2)
      assert.equal(batch.json.keys[0], 'news:https://a.test/y')
      assert.match(batch.json.keys[1], /^alert:/)
      assert.equal(radar.readItems.marks.size, 3)

      const dashboard = await call('/api/radar/dashboard')
      assert.equal(dashboard.json.readKeys.length, 3)

      const undone = await call('/api/radar/read-items/batch-delete', { method: 'POST', body: { keys: batch.json.keys } })
      assert.equal(undone.status, 204)
      const removed = await call(`/api/radar/read-items?key=${encodeURIComponent('news:https://a.test/x')}`, { method: 'DELETE' })
      assert.equal(removed.status, 204)
      assert.equal(radar.readItems.marks.size, 0)
    })

    it('validates read-item requests', async () => {
      const badUrl = await call('/api/radar/read-items', { method: 'POST', body: { kind: 'news', url: 'ftp://a.test/x' } })
      assert.equal(badUrl.status, 400)
      assert.deepEqual(badUrl.json, { error: 'Invalid request', details: [{ path: 'url', message: 'Not an http(s) URL' }] })

      const badKind = await call('/api/radar/read-items', { method: 'POST', body: { kind: 'other' } })
      assert.equal(badKind.status, 400)
      assert.equal(badKind.json.details[0].path, 'kind')

      const badKey = await call('/api/radar/read-items?key=other:abc', { method: 'DELETE' })
      assert.equal(badKey.status, 400)
      assert.deepEqual(badKey.json, { error: 'Invalid request', details: [{ path: 'key', message: 'Unknown key type' }] })

      const empty = await call('/api/radar/read-items/batch', { method: 'POST', body: { items: [] } })
      assert.equal(empty.status, 400)
      assert.equal(empty.json.details[0].path, 'items')
    })

    it('reads an article and maps a busy reader to 429', async () => {
      const ok = await call(`/api/radar/articles/read?url=${encodeURIComponent('https://example.test/a')}`)
      assert.equal(ok.status, 200)
      assert.deepEqual(ok.json, { url: 'https://example.test/a', title: 'Article' })

      const missing = await call('/api/radar/articles/read')
      assert.equal(missing.status, 400)
      assert.equal(missing.json.details[0].path, 'url')

      radar.readerState.busy = true
      const busy = await call(`/api/radar/articles/read?url=${encodeURIComponent('https://example.test/a')}`)
      radar.readerState.busy = false
      assert.equal(busy.status, 429)
      assert.equal(busy.headers.get('retry-after'), '5')
      assert.deepEqual(busy.json, { error: 'Czytnik jest zajęty, spróbuj za chwilę' })
    })
  })

  describe('logout', () => {
    it('deletes the session and clears the cookie', async () => {
      const res = await call('/api/auth/logout', { method: 'POST' })
      assert.equal(res.status, 204)
      assert.match(res.headers.get('set-cookie') ?? '', /^imbiro_session=; Path=\/; Expires=Thu, 01 Jan 1970/)
      assert.equal((await call('/api/auth/me')).status, 401)
    })
  })
})
