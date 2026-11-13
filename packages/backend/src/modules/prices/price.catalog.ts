import type { PriceShop } from '@myorg/shared'

// Known shops offered in the "add source" list. `searchUrl` opens the shop's own search with
// the item name, so the user can find the product page and paste its address.
// Reachability from a home connection was checked on 2026-11-14 (real Chrome).
export const PRICE_SHOPS: readonly PriceShop[] = [
  { id: 'mediaexpert', label: 'Media Expert', domain: 'mediaexpert.pl', searchUrl: 'https://www.mediaexpert.pl/search?query[querystring]={q}' },
  { id: 'euro', label: 'RTV Euro AGD', domain: 'euro.com.pl', searchUrl: 'https://www.euro.com.pl/search.bhtml?keyword={q}' },
  { id: 'mediamarkt', label: 'MediaMarkt', domain: 'mediamarkt.pl', searchUrl: 'https://mediamarkt.pl/pl/search.html?query={q}' },
  { id: 'xkom', label: 'x-kom', domain: 'x-kom.pl', searchUrl: 'https://www.x-kom.pl/szukaj?q={q}' },
  { id: 'morele', label: 'Morele', domain: 'morele.net', searchUrl: 'https://www.morele.net/wyszukiwarka/?q={q}' },
  { id: 'komputronik', label: 'Komputronik', domain: 'komputronik.pl', searchUrl: 'https://www.komputronik.pl/search/category/1?query={q}' },
  { id: 'empik', label: 'Empik', domain: 'empik.com', searchUrl: 'https://www.empik.com/szukaj/produkt?q={q}' },
  { id: 'avans', label: 'Avans', domain: 'avans.pl', searchUrl: 'https://www.avans.pl/search?query[querystring]={q}' },
  { id: 'electro', label: 'Electro', domain: 'electro.pl', searchUrl: 'https://www.electro.pl/search?query[querystring]={q}' },
  { id: 'allegro', label: 'Allegro', domain: 'allegro.pl', searchUrl: 'https://allegro.pl/listing?string={q}' },
  { id: 'amazon', label: 'Amazon', domain: 'amazon.pl', searchUrl: 'https://www.amazon.pl/s?k={q}' },
  { id: 'ceneo', label: 'Ceneo', domain: 'ceneo.pl', searchUrl: 'https://www.ceneo.pl/;szukaj-{q}' },
]
