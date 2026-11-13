// Public API of the scheduler module. Code outside modules/scheduler imports only from here.

export { ExecutionRepository } from './execution.repository'
export { createSchedulerRouter } from './scheduler.controller'
export { SchedulerExecutor } from './scheduler.executor'
export { SchedulerService } from './scheduler.service'
export type { ExecuteJobData } from './task.queue'
export { TaskRepository } from './task.repository'

// Actions: the contract, the registry and the built-in handlers.
export { ActionRegistry, parseWith } from './actions/action.registry'
export * from './actions/action.types'
export { createDbCleanupAction } from './actions/db-cleanup.action'
export { createEmailSendAction } from './actions/email-send.action'
export { createReportGenerateAction } from './actions/report-generate.action'
export { createTelegramSendAction } from './actions/telegram-send.action'

// Delivery channels, reusable by actions defined in other modules.
export { EmailSender } from './actions/delivery/email.client'
export { sendTelegramMessage, TELEGRAM_MAX_TEXT, telegramChatIdSchema } from './actions/delivery/telegram.client'
