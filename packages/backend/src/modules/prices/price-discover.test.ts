import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ceneoOffers, ceneoProductIds, modelToken, pickProductLink, searchQuery, titleMatches } from './price-discover'
import { parseHtml } from './price-extract'

test('modelToken and searchQuery', () => {
  assert.equal(modelToken('Ekspres Smeg BCC13BLMEU'), 'bcc13blmeu')
  assert.equal(modelToken('Samsung 990 PRO 1TB MZ-V9P1T0BW'), 'mz-v9p1t0bw')
  assert.equal(modelToken('Bialetti Moka Express 6 tz'), null)
  assert.equal(searchQuery('Ekspres Smeg BCC13BLMEU', '8017709300000'), '8017709300000')
  assert.equal(searchQuery('Ekspres Smeg BCC13BLMEU'), 'bcc13blmeu')
  assert.equal(searchQuery('Bialetti Moka Express'), 'Bialetti Moka Express')
})

test('pickProductLink: same shop, model in path, no images/search/tracking', () => {
  const html = `
    <a href="https://cdn.shop.pl/img/smeg-bcc13blmeu.jpg">img</a>
    <a href="/search?q=BCC13BLMEU">again</a>
    <a href="https://other.pl/ekspres-smeg-bcc13blmeu">other shop</a>
    <a href="/agd/ekspres-smeg-bcc13whmeu">white</a>
    <a href="/agd/ekspres-smeg-bcc13blmeu?query_id=1#reviews">black</a>`
  assert.equal(pickProductLink(html, 'https://www.shop.pl/search?q=x', 'shop.pl', 'bcc13blmeu'), 'https://www.shop.pl/agd/ekspres-smeg-bcc13blmeu')
  // Wyszukiwarka przekierowała od razu na produkt.
  assert.equal(pickProductLink('', 'https://www.euro.com.pl/ekspresy/smeg-bcc13blmeu.bhtml', 'euro.com.pl', 'bcc13blmeu'), 'https://www.euro.com.pl/ekspresy/smeg-bcc13blmeu.bhtml')
  assert.equal(pickProductLink(html, 'https://www.shop.pl/search?q=x', 'shop.pl', 'abc12345'), null)
})

test('ceneo parsing', () => {
  assert.deepEqual(ceneoProductIds('<a href="/159321660">a</a><a href="/159321660#tab">b</a><a href="/123">x</a>'), ['159321660'])
  const doc = parseHtml(`
    <div data-shopurl="avans.pl" data-price="2098.86"></div>
    <div data-shopurl="avans.pl" data-price="2100.00"></div>
    <div data-shopurl="www.konesso.pl"><span class="price">2 299,00</span></div>
    <div data-shopurl="euro.com.pl" data-productid="999" data-price="459"></div>`)
  assert.deepEqual(ceneoOffers(doc, '123'), [{ shop: 'avans.pl', price: 2098.86 }, { shop: 'konesso.pl', price: 2299 }])
})

test('titleMatches', () => {
  assert.equal(titleMatches('Ekspres SMEG BCC13BLMEU Czarny', 'Smeg BCC13BLMEU', 'bcc13blmeu'), true)
  assert.equal(titleMatches('Whirlpool WH7ITB14B3N6LW', 'Smeg BCC13BLMEU', 'bcc13blmeu'), false)
  assert.equal(titleMatches('Kawiarka Bialetti Moka Express 6 filiżanek', 'Bialetti Moka Express', null), true)
  assert.equal(titleMatches('Oryginalny pilot HISENSE Smart TV 55E8Q 50E8Q', 'Hisense 55E8Q', '55e8q'), false)
  assert.equal(titleMatches('Pilot Hisense 55E8Q', 'Pilot do Hisense 55E8Q', '55e8q'), true)
})
