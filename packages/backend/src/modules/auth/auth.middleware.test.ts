import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readCookie } from './auth.middleware'

describe('readCookie', () => {
  it('finds a cookie among others', () => {
    assert.equal(readCookie('a=1; imbiro_session=abc; b=2', 'imbiro_session'), 'abc')
  })

  it('does not match by prefix or suffix', () => {
    assert.equal(readCookie('x_imbiro_session=evil; imbiro_session_x=evil', 'imbiro_session'), undefined)
  })

  it('handles missing header, encoded values and broken encoding', () => {
    assert.equal(readCookie(undefined, 'a'), undefined)
    assert.equal(readCookie('a=x%2By', 'a'), 'x+y')
    assert.equal(readCookie('a=%E0%A4%A', 'a'), undefined)
  })
})
