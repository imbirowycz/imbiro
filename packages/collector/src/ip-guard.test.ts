import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { assertPublicUrl, BlockedUrlError, isPublicIp } from './ip-guard'

describe('isPublicIp', () => {
  it('accepts public addresses', () => {
    for (const ip of ['8.8.8.8', '2.31.115.87', '2606:4700:4700::1111']) assert.equal(isPublicIp(ip), true, ip)
  })

  it('rejects home, loopback and link-local addresses', () => {
    for (const ip of ['192.168.1.1', '10.0.0.5', '172.16.0.1', '127.0.0.1', '169.254.169.254', '100.64.0.1', '::1', '::', 'fe80::1', 'fd00::1', '::ffff:192.168.1.1', 'nope']) {
      assert.equal(isPublicIp(ip), false, ip)
    }
  })
})

describe('assertPublicUrl', () => {
  const resolveTo = (...addresses: string[]) => async () => addresses

  it('accepts an https address of a public host', async () => {
    await assertPublicUrl('https://shop.test/p/1', resolveTo('8.8.8.8'))
  })

  it('rejects non-https, private hosts and names with any private address', async () => {
    for (const [url, resolve] of [
      ['http://shop.test/', resolveTo('8.8.8.8')],
      ['https://192.168.1.1/admin', resolveTo()],
      ['https://[::1]/', resolveTo()],
      ['https://router.test/', resolveTo('192.168.1.1')],
      ['https://rebind.test/', resolveTo('8.8.8.8', '10.0.0.1')],
      ['https://nowhere.test/', resolveTo()],
      ['not a url', resolveTo('8.8.8.8')],
    ] as const) {
      await assert.rejects(assertPublicUrl(url, resolve), BlockedUrlError, url)
    }
  })
})
