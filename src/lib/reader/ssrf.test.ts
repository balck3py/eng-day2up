import { describe, expect, it } from 'vitest'
import { isBlockedIp } from './ssrf'

describe('isBlockedIp', () => {
  it.each([
    '127.0.0.1',
    '10.1.2.3',
    '172.16.0.1',
    '172.31.255.255',
    '192.168.1.1',
    '169.254.169.254',
    '0.0.0.0',
    '100.64.0.1',
    '::1',
    '::',
    'fc00::1',
    'fd12::1',
    'fe80::1',
    '::ffff:127.0.0.1',
    '::ffff:10.0.0.1',
  ])('%s 是内网/保留地址', (ip) => {
    expect(isBlockedIp(ip)).toBe(true)
  })

  it.each(['8.8.8.8', '172.32.0.1', '185.199.108.133', '2606:4700::1111'])(
    '%s 是公网地址',
    (ip) => {
      expect(isBlockedIp(ip)).toBe(false)
    },
  )
})
