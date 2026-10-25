import { ActionRegistry } from './action.registry'
import { createEmailSendAction } from './email-send.action'
import { createReportGenerateAction } from './report-generate.action'
import { createTelegramSendAction } from './telegram-send.action'

// Nowa akcja = nowy plik z handlerem + jedna linia tutaj. Rdzeń schedulera się nie zmienia.
export const actionRegistry = new ActionRegistry()
  .register(createEmailSendAction())
  .register(createTelegramSendAction())
  .register(createReportGenerateAction())

export { ActionRegistry } from './action.registry'
export * from './action.types'
