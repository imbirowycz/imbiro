import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import type { Transporter } from 'nodemailer'
import { ValidationError } from '../../../errors'
import { ActionRegistry } from './action.registry'
import { ActionConfigurationError, NonRetryableActionError, type ActionContext, type ActionHandler } from './action.types'
import { createEmailSendAction } from './email-send.action'
import { createReportGenerateAction } from './report-generate.action'
import { createTelegramSendAction } from './telegram-send.action'
import { actionRegistry } from './index'

const context: ActionContext = {
  taskId: '11111111-1111-1111-1111-111111111111',
  taskTitle: 'Test',
  executionId: '22222222-2222-2222-2222-222222222222',
  scheduledFor: new Date('2026-10-25T10:00:00Z'),
  trigger: 'schedule',
  attempt: 1,
  signal: new AbortController().signal,
  log: () => {},
}

function detailsOf(fn: () => unknown): string[] {
  try {
    fn()
  } catch (err) {
    assert.ok(err instanceof ValidationError, String(err))
    return (err.details ?? []).map((d) => `${d.path}: ${d.message}`)
  }
  assert.fail('expected ValidationError')
}

describe('ActionRegistry', () => {
  it('registers the built-in actions', () => {
    assert.deepEqual(actionRegistry.list().map((a) => a.type), ['email.send', 'telegram.send', 'report.generate'])
  })

  it('accepts a new action without changes to the core', async () => {
    const custom: ActionHandler<{ n: number }> = {
      type: 'custom.echo',
      description: 'echo',
      validateConfig: (raw) => raw as { n: number },
      execute: async (_ctx, cfg) => ({ echoed: cfg.n }),
    }
    const registry = new ActionRegistry().register(custom)
    assert.deepEqual(await registry.get('custom.echo').execute(context, { n: 7 }), { echoed: 7 })
  })

  it('rejects duplicate registration', () => {
    const registry = new ActionRegistry().register(createReportGenerateAction())
    assert.throws(() => registry.register(createReportGenerateAction()), /already registered/)
  })

  it('reports unknown action type on actionType', () => {
    const details = detailsOf(() => actionRegistry.validateConfig('sms.send', {}))
    assert.match(details[0], /^actionType: Unknown action type; available: email.send/)
  })

  it('prefixes config errors with actionConfig', () => {
    const details = detailsOf(() => actionRegistry.validateConfig('email.send', { to: 'nope', subject: 'x', text: 'y' }))
    assert.deepEqual(details, ['actionConfig.to: Invalid email address'])
  })
})

describe('email.send', () => {
  const smtp = { host: 'smtp.test', port: 587, secure: false, user: 'u', password: 'p', from: 'bot@test.dev' }

  function fakeTransport(impl: (mail: any) => Promise<any>): () => Transporter {
    return () => ({ sendMail: impl }) as unknown as Transporter
  }

  it('validates and normalizes config', () => {
    const action = createEmailSendAction()
    assert.deepEqual(action.validateConfig({ to: 'a@b.pl', subject: 'Hi', text: 'x' }).to, ['a@b.pl'])
    assert.deepEqual(detailsOf(() => action.validateConfig({ to: 'a@b.pl', subject: 'Hi' })), ['text: Provide text or html'])
    assert.ok(detailsOf(() => action.validateConfig({ to: 'a@b.pl', subject: 'Hi', text: 'x', cc: 'z' })).length > 0)
  })

  it('fails with a configuration error when SMTP is not set', async () => {
    const action = createEmailSendAction(() => null)
    const cfg = action.validateConfig({ to: 'a@b.pl', subject: 'Hi', text: 'x' })
    await assert.rejects(action.execute(context, cfg), (err) => err instanceof ActionConfigurationError && /SMTP_HOST/.test(err.message))
  })

  it('sends with a stable Message-ID per execution', async () => {
    let sent: any
    const action = createEmailSendAction(() => smtp, fakeTransport(async (mail) => {
      sent = mail
      return { messageId: mail.messageId, accepted: mail.to, rejected: [] }
    }))
    const result = await action.execute(context, action.validateConfig({ to: 'a@b.pl', subject: 'Hi', text: 'x' }))
    assert.equal(sent.from, 'bot@test.dev')
    assert.equal(sent.messageId, `<${context.executionId}@imbiro.scheduler>`)
    assert.deepEqual(result, { messageId: sent.messageId, accepted: ['a@b.pl'], rejected: [] })
  })

  it('treats SMTP 5xx and all-rejected as non-retryable, 4xx as retryable', async () => {
    const cfg = { to: ['a@b.pl'], subject: 'Hi', text: 'x' }
    const fail = (responseCode: number) =>
      createEmailSendAction(() => smtp, fakeTransport(async () => {
        throw Object.assign(new Error('nope'), { responseCode })
      })).execute(context, cfg)

    await assert.rejects(fail(550), NonRetryableActionError)
    await assert.rejects(fail(421), (err) => !(err instanceof NonRetryableActionError))

    const allRejected = createEmailSendAction(() => smtp, fakeTransport(async () => ({ messageId: 'm', accepted: [], rejected: ['a@b.pl'] })))
    await assert.rejects(allRejected.execute(context, cfg), NonRetryableActionError)
  })
})

describe('telegram.send', () => {
  const token = '123:SECRET'
  const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as typeof fetch

  it('validates config', () => {
    const action = createTelegramSendAction()
    assert.equal(action.validateConfig({ chatId: '@my_channel', text: 'x' }).chatId, '@my_channel')
    assert.equal(action.validateConfig({ chatId: -1001234, text: 'x' }).chatId, -1001234)
    assert.ok(detailsOf(() => action.validateConfig({ chatId: 'abc', text: '' })).length === 2)
  })

  it('fails with a configuration error without a token', async () => {
    const action = createTelegramSendAction(() => undefined)
    await assert.rejects(action.execute(context, { chatId: 1, text: 'x' }), (err) => err instanceof ActionConfigurationError && /TELEGRAM_BOT_TOKEN/.test(err.message))
  })

  it('returns the message id on success', async () => {
    const action = createTelegramSendAction(() => token, reply(200, { ok: true, result: { message_id: 42 } }))
    assert.deepEqual(await action.execute(context, { chatId: 1, text: 'x' }), { messageId: 42, chatId: 1 })
  })

  it('classifies API errors and never leaks the token', async () => {
    const bad = createTelegramSendAction(() => token, reply(400, { ok: false, error_code: 400, description: 'Bad Request: chat not found' }))
    await assert.rejects(bad.execute(context, { chatId: 1, text: 'x' }), (err) => err instanceof NonRetryableActionError && /chat not found/.test(err.message))

    const limited = createTelegramSendAction(() => token, reply(429, { ok: false, error_code: 429, description: 'Too Many Requests' }))
    await assert.rejects(limited.execute(context, { chatId: 1, text: 'x' }), (err) => !(err instanceof NonRetryableActionError))

    const offline = createTelegramSendAction(() => token, (async (url: string) => {
      throw new Error(`connect ECONNREFUSED ${url}`)
    }) as unknown as typeof fetch)
    await assert.rejects(offline.execute(context, { chatId: 1, text: 'x' }), (err: Error) => /Telegram request failed/.test(err.message))
  })
})

describe('report.generate', () => {
  it('defaults periodHours to 24', () => {
    assert.deepEqual(createReportGenerateAction().validateConfig(undefined), { periodHours: 24 })
    assert.ok(detailsOf(() => createReportGenerateAction().validateConfig({ periodHours: 0 })).length > 0)
  })

  it('aggregates executions per task', async () => {
    const db = {
      query: async () => ({
        rows: [
          { task_id: 'a', title: 'A', succeeded: 3, failed: 1, other: 0, avg_duration_ms: 120.4, last_run_at: new Date('2026-10-25T09:00:00Z') },
          { task_id: 'b', title: 'B', succeeded: 1, failed: 0, other: 1, avg_duration_ms: null, last_run_at: null },
        ],
      }),
    }
    const action = createReportGenerateAction(() => db as any)
    const result = (await action.execute(context, { periodHours: 24 })) as any
    assert.deepEqual(result.totals, { succeeded: 4, failed: 1, inProgress: 1 })
    assert.equal(result.tasks[0].avgDurationMs, 120)
  })
})
