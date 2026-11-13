import { z } from 'zod'
import type { RunTarget } from '@myorg/shared'
import { config } from '../../../core/config'
import {
  ActionConfigurationError,
  EmailSender,
  parseWith,
  sendTelegramMessage,
  TELEGRAM_MAX_TEXT,
  telegramChatIdSchema,
  type ActionHandler,
} from '../../scheduler'
import type { ModuleRegistry } from '../core/module.registry'
import { MAX_MODULES_PER_RUN, type ModuleRunner } from '../core/module.runner'
import { buildDigest, renderEmail, renderTelegram } from './digest'

// Adapter between Personal Radar and the scheduler: one action that runs radar modules and
// delivers the result. It lives in the radar module and uses only the scheduler's public API,
// so the scheduler itself knows nothing about the radar. The result is passed between the two steps in memory,
// inside a single execution — the scheduler core and its contract stay unchanged.

const targetSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('module'), id: z.string().min(1) }),
  z.strictObject({ kind: z.literal('group'), id: z.string().min(1) }),
  z.strictObject({ kind: z.literal('modules'), ids: z.array(z.string().min(1)).min(1).max(MAX_MODULES_PER_RUN) }),
])

const channelSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('telegram'),
    chatId: telegramChatIdSchema,
    disableNotification: z.boolean().optional(),
  }),
  z.strictObject({
    type: z.literal('email'),
    to: z.union([z.email(), z.array(z.email()).min(1).max(50)]).transform((to) => (Array.isArray(to) ? to : [to])),
    subject: z.string().trim().min(1).max(500),
  }),
])

function configSchema(registry: ModuleRegistry) {
  return z
    .strictObject({
      target: targetSchema,
      channel: channelSchema,
      /** Optional heading; defaults to the task title. */
      title: z.string().trim().min(1).max(200).optional(),
      maxItemsPerModule: z.number().int().min(1).max(20).default(5),
    })
    .superRefine((value, ctx) => {
      // Ids are checked when the task is saved, so a typo is reported in the form, not at 7:00.
      const { target } = value
      if (target.kind === 'group' && !registry.hasGroup(target.id)) {
        ctx.addIssue({ code: 'custom', path: ['target', 'id'], message: 'Unknown radar group' })
      }
      if (target.kind === 'module' && !registry.has(target.id)) {
        ctx.addIssue({ code: 'custom', path: ['target', 'id'], message: 'Unknown radar module' })
      }
      if (target.kind === 'modules') {
        target.ids.forEach((id, index) => {
          if (!registry.has(id)) ctx.addIssue({ code: 'custom', path: ['target', 'ids', index], message: 'Unknown radar module' })
        })
      }
    })
}

export type RadarDeliverConfig = z.output<ReturnType<typeof configSchema>>

export interface RadarDeliverDeps {
  registry: ModuleRegistry
  runner: ModuleRunner
  /** Keys of news/alerts marked as read (skipped in the digest). */
  getReadKeys: () => Promise<string[]>
  getTelegramToken?: () => string | undefined
  fetchImpl?: typeof fetch
  email?: EmailSender
}

export function createRadarDeliverAction(deps: RadarDeliverDeps): ActionHandler<RadarDeliverConfig> {
  const { registry, runner, getReadKeys } = deps
  const getTelegramToken = deps.getTelegramToken ?? (() => config.integrations.telegram.botToken)
  const email = deps.email ?? new EmailSender()
  const schema = configSchema(registry)

  return {
    type: 'radar.deliver',
    description: 'Uruchamia moduły Personal Radar i wysyła wynik przez Telegram albo e-mail',
    validateConfig: (raw) => parseWith(schema, raw),

    async execute(context, cfg) {
      // Check the channel first: no point fetching sources if delivery cannot work.
      const token = cfg.channel.type === 'telegram' ? getTelegramToken() : undefined
      if (cfg.channel.type === 'telegram' && !token) {
        throw new ActionConfigurationError('radar.deliver is not configured: set TELEGRAM_BOT_TOKEN')
      }
      if (cfg.channel.type === 'email') email.assertConfigured()

      const run = await runner.run(cfg.target as RunTarget, { signal: context.signal })
      const modules = run.results.map((result) => ({
        id: result.moduleId,
        status: result.status,
        items: result.data.length,
        cached: result.cached,
        error: result.error?.code ?? null,
      }))
      context.log(`radar run ${run.status}: ${modules.map((m) => `${m.id}=${m.status}`).join(', ')}`)

      // Nothing to send: let the scheduler retry later (with backoff) instead of sending an empty report.
      if (run.status === 'error') {
        throw new Error(`All radar modules failed: ${modules.map((m) => `${m.id} ${m.error}`).join(', ')}`)
      }

      // A failed lookup must not block the morning digest: send it with read news included.
      const readKeys = await getReadKeys().catch((err: unknown) => {
        context.log(`read items unavailable, sending without the filter: ${(err as Error).message}`)
        return [] as string[]
      })
      const digest = buildDigest(cfg.title ?? context.taskTitle, run, registry, cfg.maxItemsPerModule, { skipKeys: readKeys })

      // Only a summary goes back to the scheduler (task_executions.result) — never the fetched data.
      const summary = { target: cfg.target, runStatus: run.status, modules }

      if (cfg.channel.type === 'telegram') {
        const { messageId } = await sendTelegramMessage(
          token!,
          {
            chatId: cfg.channel.chatId,
            text: renderTelegram(digest, TELEGRAM_MAX_TEXT),
            parseMode: 'HTML',
            disableNotification: cfg.channel.disableNotification,
            disableLinkPreview: true,
          },
          context.signal,
          deps.fetchImpl
        )
        return { ...summary, delivered: { channel: 'telegram', messageId } }
      }

      const sent = await email.send(
        { to: cfg.channel.to, subject: cfg.channel.subject, ...renderEmail(digest) },
        `<${context.executionId}@imbiro.scheduler>`
      )
      return { ...summary, delivered: { channel: 'email', messageId: sent.messageId, accepted: sent.accepted } }
    },
  }
}
