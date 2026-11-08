import { applyOffers } from './price-evaluate'
import { PriceCheckWorker } from './price-worker'
import { PricesRepository } from './prices.repository'

/** Złożenie workera sprawdzeń z hookami (ocena okazji, powiadomienia). */
export function createPriceCheckWorker(repo = new PricesRepository()): PriceCheckWorker {
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
        return { offers: changes.map((c) => `${c.offer.kind}:${c.change}`) }
      },
    },
    repo
  )
}
