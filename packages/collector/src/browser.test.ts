import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { siteCookiePattern } from './browser'

describe('siteCookiePattern', () => {
  const pattern = siteCookiePattern('https://www.euro.com.pl/ekspresy-cisnieniowe/smeg-bcc13blmeu.bhtml')

  it('matches the cookie domains of the site and its subdomains', () => {
    for (const domain of ['euro.com.pl', '.euro.com.pl', 'www.euro.com.pl', 'api.euro.com.pl']) assert.ok(pattern.test(domain), domain)
  })

  it('leaves other sites alone', () => {
    for (const domain of ['.com.pl', 'neweuro.com.pl', '.mediaexpert.pl', 'euro.com.pl.evil.com']) assert.ok(!pattern.test(domain), domain)
  })
})
