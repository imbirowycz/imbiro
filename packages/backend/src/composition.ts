import { LoginLimiter, SessionRepository } from './modules/auth'
import { createRadarDeliverAction, createReadItemsRepository, radarRegistry, radarRunner } from './modules/radar'
import {
  ActionRegistry,
  createDbCleanupAction,
  createEmailSendAction,
  createReportGenerateAction,
  createTelegramSendAction,
} from './modules/scheduler'

// The one place where modules are wired together.

/**
 * Every action the scheduler can run. New action = a new file with a handler (in the module that
 * owns the logic) + one line here. The scheduler core does not change.
 */
export function createActionRegistry(): ActionRegistry {
  return new ActionRegistry()
    .register(createEmailSendAction())
    .register(createTelegramSendAction())
    .register(createReportGenerateAction())
    .register(
      createRadarDeliverAction({
        registry: radarRegistry,
        runner: radarRunner,
        getReadKeys: () => createReadItemsRepository().listKeys(),
      })
    )
    .register(
      createDbCleanupAction({
        sessions: new SessionRepository(),
        loginLimiter: new LoginLimiter(),
        readItems: () => createReadItemsRepository(),
      })
    )
}
