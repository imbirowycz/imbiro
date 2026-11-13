import assert from 'node:assert/strict'
import { test } from 'node:test'
import { detectOffers, dropOf } from './price-evaluate'

const rules = { minDropPct: 5, targetPrice: null }
const kinds = (list: { kind: string }[]) => list.map((c) => c.kind)

test('price drop respects minimum percentage', () => {
  assert.deepEqual(kinds(detectOffers(rules, { price: 200, available: true }, { price: 189, oldPrice: null, available: true })), ['price_drop'])
  assert.deepEqual(kinds(detectOffers(rules, { price: 200, available: true }, { price: 195, oldPrice: null, available: true })), [])
  assert.deepEqual(kinds(detectOffers({ minDropPct: 0, targetPrice: null }, { price: 200, available: true }, { price: 199.99, oldPrice: null, available: true })), ['price_drop'])
})

test('first measurement can be a promo or target, never a drop', () => {
  assert.deepEqual(kinds(detectOffers({ minDropPct: 5, targetPrice: 200 }, null, { price: 189, oldPrice: 229, available: true })), ['promo', 'target_reached'])
})

test('back in stock and unavailable products', () => {
  assert.deepEqual(kinds(detectOffers(rules, { price: 189, available: false }, { price: 189, oldPrice: null, available: true })), ['back_in_stock'])
  assert.deepEqual(detectOffers(rules, { price: 200, available: true }, { price: 100, oldPrice: 150, available: false }), [])
})

test('price going up is not an offer', () => {
  assert.deepEqual(detectOffers(rules, { price: 189, available: true }, { price: 219, oldPrice: null, available: true }), [])
})

test('dropOf', () => {
  assert.deepEqual(dropOf(189.99, 229), { dropAmount: 39.01, dropPct: 17.03 })
  assert.deepEqual(dropOf(200, 189), { dropAmount: null, dropPct: null })
  assert.deepEqual(dropOf(200, null), { dropAmount: null, dropPct: null })
})
