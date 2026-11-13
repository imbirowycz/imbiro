import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { assertSelectorsValid, compareWithExpected, DefinitionError, extractProduct } from './price-extract'
import { isCaptchaUrl, looksBlocked } from './price-html'

const fixture = (name: string) => readFileSync(path.join(__dirname, '__fixtures__', name), 'utf8')

test('auto: JSON-LD Product in @graph with strikethrough price', () => {
  const { extraction } = extractProduct(fixture('jsonld.html'), { version: 1, strategy: 'auto' })
  assert.equal(extraction.price, 189.99)
  assert.equal(extraction.oldPrice, 229)
  assert.equal(extraction.available, true)
  assert.equal(extraction.currency, 'PLN')
  assert.equal(extraction.title, 'Bialetti Moka Express 6 tz')
  assert.equal(extraction.strategyUsed, 'jsonld')
})

test('auto: OpenGraph wins over microdata when JSON-LD is missing', () => {
  const { extraction } = extractProduct(fixture('og-micro.html'), { version: 1, strategy: 'auto' })
  assert.equal(extraction.price, 179)
  assert.equal(extraction.strategyUsed, 'opengraph')
  assert.equal(extraction.available, true)
})

test('css: selectors, nbsp prices, availability and match counts', () => {
  const { extraction, selectorMatches } = extractProduct(fixture('css.html'), {
    version: 1,
    strategy: 'css',
    price: { selector: '.price-box .current', parse: 'pl-price' },
    oldPrice: { selector: '.price-box del' },
    title: { selector: '[data-testid=name]', parse: 'text' },
    availability: { selector: '[data-stock]', attr: 'data-stock', inStockIf: ['available'] },
  })
  assert.equal(extraction.price, 1299.99)
  assert.equal(extraction.oldPrice, 1499)
  assert.equal(extraction.title, 'Bialetti Moka Express 6 tz')
  assert.equal(extraction.available, true)
  assert.equal(extraction.strategyUsed, 'css')
  assert.deepEqual(selectorMatches.map((m) => m.count), [1, 1, 1, 1])
})

test('css: missing price element gives null price and a warning', () => {
  const { extraction } = extractProduct(fixture('css.html'), { version: 1, strategy: 'css', price: { selector: '.nope' } })
  assert.equal(extraction.price, null)
  assert.equal(extraction.strategyUsed, null)
  assert.ok(extraction.warnings.some((w) => w.includes('Nie znaleziono ceny')))
})

test('ambiguous selector warns and uses the first match', () => {
  const { extraction } = extractProduct(fixture('css.html'), { version: 1, strategy: 'css', price: { selector: '.current' } })
  assert.equal(extraction.price, 1299.99)
  assert.ok(extraction.warnings.some((w) => w.includes('2 elementy')))
})

test('invalid selector is a definition error', () => {
  assert.throws(() => assertSelectorsValid({ version: 1, strategy: 'css', price: { selector: 'div[[' } }), DefinitionError)
})

test('compareWithExpected', () => {
  const { extraction } = extractProduct(fixture('jsonld.html'), { version: 1, strategy: 'auto' })
  const result = compareWithExpected(extraction, { price: 189.99, oldPrice: 199, title: 'moka express', available: true })
  assert.deepEqual(result.map((r) => [r.field, r.ok]), [['price', true], ['oldPrice', false], ['title', true], ['available', true]])
})

test('looksBlocked', () => {
  assert.equal(looksBlocked(403, ''), true)
  assert.equal(looksBlocked(202, '<html>verify</html>'), true)
  assert.equal(looksBlocked(200, '<title>Just a moment...</title><div id="challenge-platform"></div>'), true)
  assert.equal(looksBlocked(200, fixture('css.html')), false)
})

test('isCaptchaUrl', () => {
  assert.equal(isCaptchaUrl('https://www.ceneo.pl/Captcha/Add?returnUrl=x'), true)
  assert.equal(isCaptchaUrl('https://www.ceneo.pl/12345'), false)
  assert.equal(isCaptchaUrl(null), false)
})

test('CSS that crashes jsdom is stripped before parsing', () => {
  const html = '<html><head><style>.a{border:initial}</style><link rel="stylesheet" href="/x.css"></head><body><div style="border: initial"><span class="p">99 zł</span></div></body></html>'
  const { extraction } = extractProduct(html, { version: 1, strategy: 'css', price: { selector: '.p' } })
  assert.equal(extraction.price, 99)
})
