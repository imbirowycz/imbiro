import type { PgBoss } from 'pg-boss'
import type { AppDeps } from './app'
import { LoginLimiter, SessionRepository } from './modules/auth'
import { config } from './core/config'
import {
  createCollectorRouter,
  createPricesRouter,
  createPriceWatchAction,
  PriceCheckProcessor,
  PriceNotifier,
  PriceQueue,
  PricesRepository,
  PricesService,
} from './modules/prices'
import {
  ArticleReader,
  createRadarDeliverAction,
  createRadarRegistry,
  ModuleRunner,
  radarConfig,
  ReadItemsRepository,
} from './modules/radar'
import {
  ActionRegistry,
  createDbCleanupAction,
  createEmailSendAction,
  createReportGenerateAction,
  createTelegramSendAction,
  ExecutionRepository,
  SchedulerExecutor,
  SchedulerService,
  TaskRepository,
} from './modules/scheduler'

// The one place where modules are wired together. Nothing else creates repositories, registries
// or services — a class receives its collaborators here, so this file shows what depends on what.
// The API and the Worker are separate processes: each builds its own set (own radar cache).

/** Objects both processes need. */
function composeCore(boss: PgBoss) {
  // auth
  const sessions = new SessionRepository()
  const loginLimiter = new LoginLimiter()

  // radar: one registry and one runner (with its in-memory cache) per process
  const radarRegistry = createRadarRegistry()
  const radarRunner = new ModuleRunner(radarRegistry)
  const readItems = new ReadItemsRepository()

  // prices: checks are queued here and fetched by the home collector through the API
  const priceRepo = new PricesRepository()
  const priceQueue = new PriceQueue(boss)

  // scheduler
  // New action = a new file with a handler (in the module that owns the logic) + one line here.
  const actions = new ActionRegistry()
    .register(createEmailSendAction())
    .register(createTelegramSendAction())
    .register(createReportGenerateAction())
    .register(createRadarDeliverAction({ registry: radarRegistry, runner: radarRunner, getReadKeys: () => readItems.listKeys() }))
    .register(createPriceWatchAction({ repo: priceRepo, queue: priceQueue }))
    .register(createDbCleanupAction({ sessions, loginLimiter, readItems, priceObservations: priceRepo }))
  const tasks = new TaskRepository()
  const executions = new ExecutionRepository()
  const scheduler = new SchedulerService(boss, actions, tasks, executions)

  return { sessions, loginLimiter, radarRegistry, radarRunner, readItems, priceRepo, priceQueue, actions, tasks, executions, scheduler }
}

/** Everything the Express app needs (see createApp). */
export function composeApi(boss: PgBoss): AppDeps {
  const core = composeCore(boss)
  const { priceRepo, priceQueue } = core
  const priceNotifier = new PriceNotifier(priceRepo)
  const { collectorToken, onlineWithinSeconds, ...collectorSettings } = config.prices
  return {
    sessions: core.sessions,
    loginLimiter: core.loginLimiter,
    scheduler: core.scheduler,
    actions: core.actions,
    radar: {
      registry: core.radarRegistry,
      runner: core.radarRunner,
      readItems: core.readItems,
      // Only the API reads articles; the Worker never does.
      reader: new ArticleReader({ allowedDomains: radarConfig.reader.allowedDomains }),
    },
    prices: createPricesRouter(new PricesService(core.scheduler, core.tasks, priceRepo, priceQueue, onlineWithinSeconds), priceNotifier),
    collector: createCollectorRouter({
      token: collectorToken,
      settings: collectorSettings,
      queue: priceQueue,
      repo: priceRepo,
      processor: new PriceCheckProcessor(priceRepo, priceQueue, priceNotifier),
    }),
  }
}

/** Everything the Worker process needs: queue maintenance and job execution. */
export function composeWorker(boss: PgBoss): { scheduler: SchedulerService; executor: SchedulerExecutor } {
  const core = composeCore(boss)
  return {
    scheduler: core.scheduler,
    executor: new SchedulerExecutor(boss, core.actions, core.tasks, core.executions),
  }
}
