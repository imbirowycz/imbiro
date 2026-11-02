import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { isRecent } from '../../parsing/news.normalize'
import { parsePolscyProgramisci } from './polscy-programisci.module'

const card = (opts: { href: string; title: string; excerpt?: string; source?: string; date?: string }) => `
<article class="article-card featured">
  <a href="${opts.href}" class="article-image-wrap" target="_blank"><img src="x.jpg" alt=""></a>
  <div class="article-card-inner">
    <span class="article-source">${opts.source ?? 'sekurak.pl · w biegu'}</span>
    <a href="${opts.href}" class="article-primary-link" target="_blank" rel="noopener noreferrer" >
      <h2 class="article-title">${opts.title}</h2>
      ${opts.excerpt ? `<p class="article-excerpt">${opts.excerpt}</p>` : ''}
    </a>
    <div class="article-meta">
      <span class="meta-item"><svg width="12" height="12"><rect x="3" y="4"/></svg>
        ${opts.date ?? '02.11.2026'}
      </span>
      <a class="meta-item" href="https://polscyprogramisci.pl/zrodla/sekurakpl">sekurak.pl</a>
    </div>
  </div>
</article>`

describe('parsePolscyProgramisci', () => {
  it('reads title, original link, excerpt, site and day from each card', () => {
    const html = `<main>${card({
      href: 'https://mamstartup.pl/artykul/?utm_source=pp',
      title: 'Nowy &quot;startup&quot; roku',
      excerpt: 'Krótki opis...',
      source: 'mamstartup.pl · news',
      date: '01.11.2026',
    })}${card({ href: 'https://sekurak.pl/a/', title: 'Drugi' })}</main>`

    const items = parsePolscyProgramisci(html, 'Europe/Warsaw')

    assert.equal(items.length, 2)
    assert.equal(items[0].title, 'Nowy "startup" roku')
    assert.equal(items[0].url, 'https://mamstartup.pl/artykul/')
    assert.equal(items[0].summary, 'Krótki opis...')
    assert.equal(items[0].source, 'mamstartup.pl')
    assert.equal(items[0].category, 'it')
    // Midnight in Warsaw (CET, UTC+1) on 1 November.
    assert.equal(items[0].publishedAt, '2026-10-31T23:00:00.000Z')
    assert.equal(items[1].summary, null)
  })

  it('skips cards without a link or a title, and returns nothing for an unknown layout', () => {
    assert.equal(parsePolscyProgramisci(card({ href: 'javascript:alert(1)', title: 'X' }), 'Europe/Warsaw').length, 0)
    assert.equal(parsePolscyProgramisci(card({ href: 'https://a.pl/', title: '' }), 'Europe/Warsaw').length, 0)
    assert.equal(parsePolscyProgramisci('<div class="post">nic</div>', 'Europe/Warsaw').length, 0)
  })
})

describe('isRecent', () => {
  const now = new Date('2026-11-02T12:00:00Z')
  it('keeps items up to maxAgeDays old and undated items, drops older ones', () => {
    assert.equal(isRecent({ publishedAt: '2026-10-30T12:00:00.000Z' }, now, 3), true)
    assert.equal(isRecent({ publishedAt: '2026-10-30T11:59:00.000Z' }, now, 3), false)
    assert.equal(isRecent({ publishedAt: null }, now, 3), true)
  })
})
