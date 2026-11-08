import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseNumber, parsePlPrice } from './price-parse'

test('parsePlPrice handles Polish and other price formats', () => {
  const cases: [string, number | null][] = [
    ['1 299,99 zł', 1299.99],
    ['1 299,99 zł', 1299.99],
    ['1 299 zł', 1299],
    ['1.299,00 zł', 1299],
    ['1,299.00', 1299],
    ['189,-', 189],
    ['189,- zł', 189],
    ['od 89 zł', 89],
    ['189.99', 189.99],
    ['189,9', 189.9],
    ['1.299', 1299],
    ['12 345 678,50', 12345678.5],
    ['PLN 49,00', 49],
    ['brak', null],
    ['', null],
  ]
  for (const [input, expected] of cases) assert.equal(parsePlPrice(input), expected, input)
})

test('parseNumber prefers machine format', () => {
  assert.equal(parseNumber('1299.99'), 1299.99)
  assert.equal(parseNumber('189'), 189)
  assert.equal(parseNumber('1 299,00 zł'), 1299)
  assert.equal(parseNumber(null), null)
})
