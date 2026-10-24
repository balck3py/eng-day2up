import { describe, it, expect } from 'vitest'
import { arpabetToIpa, cmuCompound, cmuExact } from './arpabet'

describe('arpabetToIpa', () => {
  it('复数、进行时这类屈折形式', () => {
    expect(arpabetToIpa('D IH1 JH AH0 T S')).toBe('ˈdɪdʒəts')
    expect(arpabetToIpa('R IH0 S T AO1 R IH0 NG')).toBe('rɪˈstɔːrɪŋ')
  })
  it('重音符号放在合法首辅音丛前', () => {
    expect(arpabetToIpa('K AA1 N S T R AH0 K T')).toBe('ˈkɑːnstrəkt')
    expect(arpabetToIpa('K AH0 N S T R AH1 K T')).toBe('kənˈstrʌkt')
    expect(arpabetToIpa('IH2 N T ER0 V EH1 N SH AH0 N')).toBe('ˌɪntɚˈvenʃən')
  })
  it('ER 后接元音时拆出 r 归下一音节', () => {
    expect(arpabetToIpa('K ER0 AH1 P SH AH0 N')).toBe('kəˈrʌpʃən')
  })
  it('s+f 不算首辅音丛', () => {
    expect(arpabetToIpa('S AE2 T AH0 S F AE1 K SH AH0 N')).toBe('ˌsætəsˈfækʃən')
  })
  it('紧挨主重音的前缀次重音不标', () => {
    expect(arpabetToIpa('IH2 N JH EH1 S T')).toBe('ɪnˈdʒest')
  })
  it('单音节不标重音', () => {
    expect(arpabetToIpa('S T IY1 L')).toBe('stiːl')
  })
})

describe('cmuExact / cmuCompound', () => {
  const dict = { trade: 'T R EY1 D', off: 'AO1 F', digits: 'D IH1 JH AH0 T S' }
  it('按词形查，大小写无关', () => {
    expect(cmuExact('Digits', dict)).toBe('/ˈdɪdʒəts/')
    expect(cmuExact('stdlib', dict)).toBeNull()
  })
  it('复合词拆开拼，有一段查不到就放弃', () => {
    expect(cmuCompound('trade-off', dict)).toBe('/treɪd-ɔːf/')
    expect(cmuCompound('trade-xyz', dict)).toBeNull()
    expect(cmuCompound('digits', dict)).toBeNull()
  })
})
