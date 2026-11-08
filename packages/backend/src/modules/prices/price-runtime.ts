import { applyOffers } from './price-evaluate'
import { PriceNotifier } from './price-notify'
import { PriceCheckWorker } from './price-worker'
import { PricesRepository } from './prices.repository'

/** Złożenie workera sprawdzeń z hookami: ocena okazji i powiadomienia. */
export function createPriceCheckWorker(repo = new PricesRepository(), notifier = new PriceNotifier(repo)): PriceCheckWorker {
  return new PriceCheckWorker(
    {
      async onSuccess(item, source, outcome) {
        const extraction = outcome.extraction!
        const changes = await applyOffers(repo, item, source, {
          price: extraction.price!,
          oldPrice: extraction.oldPrice,
          available: extraction.available,
          title: extraction.title,
          currency: extraction.currency,
          url: source.url,
        })
        if (changes.length) await notifier.notifyOffers(item, source, changes)
        return { offers: changes.map((c) => `${c.offer.kind}:${c.change}`) }
      },
      onFailing: (item, source, status, error) => notifier.notifyFailing(item, source, status, error),
    },
    repo
  )
}
