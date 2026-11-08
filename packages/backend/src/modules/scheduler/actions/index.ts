import { ActionRegistry } from './action.registry'
import { createDbCleanupAction } from './db-cleanup.action'
import { createEmailSendAction } from './email-send.action'
import { createPriceWatchAction } from './price-watch.action'
import { createRadarDeliverAction } from './radar-deliver.action'
import { createReportGenerateAction } from './report-generate.action'
import { createTelegramSendAction } from './telegram-send.action'

// Nowa akcja = nowy plik z handlerem + jedna linia tutaj. Rdzeń schedulera się nie zmienia.
export const actionRegistry = new ActionRegistry()
  .register(createEmailSendAction())
  .register(createTelegramSendAction())
  .register(createReportGenerateAction())
  .register(createRadarDeliverAction())
  .register(createDbCleanupAction())
  .register(createPriceWatchAction())

export { ActionRegistry } from './action.registry'
export * from './action.types'
