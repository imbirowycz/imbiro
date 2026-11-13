'use strict'
const test = require('node:test')
const assert = require('node:assert')
const { isPublicIp, isValidHost } = require('./ip-guard')

test('blokuje adresy sieci domowej i specjalne (IPv4)', () => {
  for (const ip of [
    '0.0.0.0', '10.1.2.3', '100.64.0.1', '100.127.255.255', '127.0.0.1', '169.254.169.254',
    '172.16.0.1', '172.31.255.255', '192.168.0.1', '192.168.1.1', '192.0.2.5', '198.18.0.1',
    '224.0.0.1', '255.255.255.255',
  ]) {
    assert.strictEqual(isPublicIp(ip), false, ip)
  }
})

test('przepuszcza publiczne IPv4', () => {
  for (const ip of ['1.1.1.1', '8.8.8.8', '2.31.115.87', '172.15.255.255', '172.32.0.1', '100.63.255.255', '100.128.0.1']) {
    assert.strictEqual(isPublicIp(ip), true, ip)
  }
})

test('IPv6: blokuje lokalne, mapowane i NAT64 na prywatne', () => {
  for (const ip of [
    '::', '::1', 'fe80::1', 'fe80::1%en0', 'fd00::1', 'fc12:3456::1', 'ff02::1', '2001:db8::1',
    '::ffff:192.168.1.1', '::ffff:127.0.0.1', '::ffff:c0a8:0101', '64:ff9b::10.0.0.1', '::127.0.0.1',
  ]) {
    assert.strictEqual(isPublicIp(ip), false, ip)
  }
})

test('IPv6: przepuszcza publiczne', () => {
  for (const ip of ['2a01:4f8::1', '2606:4700:4700::1111', '::ffff:8.8.8.8', '64:ff9b::8.8.8.8']) {
    assert.strictEqual(isPublicIp(ip), true, ip)
  }
})

test('odrzuca nie-adresy', () => {
  assert.strictEqual(isPublicIp('localhost'), false)
  assert.strictEqual(isPublicIp(''), false)
})

test('walidacja hosta', () => {
  assert.ok(isValidHost('www.x-kom.pl'))
  assert.ok(isValidHost('1.2.3.4'))
  assert.ok(!isValidHost('x-kom.pl/../'))
  assert.ok(!isValidHost('a b'))
  assert.ok(!isValidHost(''))
  assert.ok(!isValidHost('-zly.pl'))
})
