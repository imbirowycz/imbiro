import { PriceCheckWorker } from './price-worker'

/** Złożenie workera sprawdzeń z hookami (ocena okazji, powiadomienia). */
export function createPriceCheckWorker(): PriceCheckWorker {
  return new PriceCheckWorker({})
}
