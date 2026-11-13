import assert from 'node:assert/strict'
import { test } from 'node:test'
import { formatOffer } from './price-notify'

test('formatOffer: title, source, price, drop and link; HTML escaped', () => {
  const item = { name: 'Kawiarka <6 tz>' } as never
  const source = { label: 'Sklep & Co' } as never
  const offer = {
    id: 'o1', kind: 'price_drop', title: 'Bialetti', url: 'https://sklep.pl/p?a=1&b=2', price: 189.99, previousPrice: 229,
    dropAmount: 39.01, dropPct: 17.03, currency: 'PLN', detectedAt: new Date(),
  }
  const msg = formatOffer(item, source, { offer: offer as never, change: 'new' })
  assert.match(msg.subject, /Obniżka ceny: Kawiarka <6 tz> — 189,99 zł w Sklep & Co/)
  assert.match(msg.text, /było 229,00 zł, −39,01 zł \/ −17.03%/)
  assert.match(msg.html, /Kawiarka &lt;6 tz&gt;/)
  assert.match(msg.html, /href="https:\/\/sklep.pl\/p\?a=1&amp;b=2"/)
})
