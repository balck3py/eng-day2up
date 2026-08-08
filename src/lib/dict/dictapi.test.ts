import { describe, it, expect } from 'vitest'
import { parseDictApi } from './dictapi'

describe('parseDictApi', () => {
  it('按音频文件名区分美英', () => {
    const json = [{
      phonetics: [
        { text: '/həˈləʊ/', audio: 'https://x/hello-uk.mp3' },
        { text: '/həˈloʊ/', audio: 'https://x/hello-us.mp3' },
      ],
    }]
    expect(parseDictApi(json)).toEqual({
      phoneticUs: '/həˈloʊ/',
      phoneticUk: '/həˈləʊ/',
      audioUs: 'https://x/hello-us.mp3',
      audioUk: 'https://x/hello-uk.mp3',
    })
  })

  it('只有无标记音标时，美英同时回退到它', () => {
    const json = [{ phonetics: [{ text: '/wɜːd/', audio: '' }] }]
    expect(parseDictApi(json)).toEqual({
      phoneticUs: '/wɜːd/',
      phoneticUk: '/wɜːd/',
      audioUs: null,
      audioUk: null,
    })
  })

  it('只有美音时英音回退到无标记音标', () => {
    const json = [{
      phonetics: [
        { text: '/fɔːlbæk/', audio: '' },
        { text: '/ˈjuːɛs/', audio: 'https://x/w-us.mp3' },
      ],
    }]
    const r = parseDictApi(json)
    expect(r.phoneticUs).toBe('/ˈjuːɛs/')
    expect(r.audioUs).toBe('https://x/w-us.mp3')
    expect(r.phoneticUk).toBe('/fɔːlbæk/')
    expect(r.audioUk).toBeNull()
  })

  it('有音频无文本时不编造音标', () => {
    const json = [{ phonetics: [{ text: '', audio: 'https://x/w-us.mp3' }] }]
    const r = parseDictApi(json)
    expect(r.audioUs).toBe('https://x/w-us.mp3')
    expect(r.phoneticUs).toBeNull()
  })

  it('取每个方言的第一个音标，忽略后续', () => {
    const json = [{
      phonetics: [
        { text: '/first/', audio: 'https://x/a-us.mp3' },
        { text: '/second/', audio: 'https://x/b-us.mp3' },
      ],
    }]
    const r = parseDictApi(json)
    expect(r.phoneticUs).toBe('/first/')
    expect(r.audioUs).toBe('https://x/a-us.mp3')
  })

  it('跨多个词条合并', () => {
    const json = [
      { phonetics: [{ text: '/uk/', audio: 'https://x/a-uk.mp3' }] },
      { phonetics: [{ text: '/us/', audio: 'https://x/a-us.mp3' }] },
    ]
    const r = parseDictApi(json)
    expect(r.phoneticUk).toBe('/uk/')
    expect(r.phoneticUs).toBe('/us/')
  })

  it('空数组返回全 null', () => {
    expect(parseDictApi([])).toEqual({
      phoneticUs: null, phoneticUk: null, audioUs: null, audioUk: null,
    })
  })

  it('非数组输入返回全 null', () => {
    expect(parseDictApi({ title: 'No Definitions Found' })).toEqual({
      phoneticUs: null, phoneticUk: null, audioUs: null, audioUk: null,
    })
  })

  it('缺少 phonetics 字段不抛异常', () => {
    expect(() => parseDictApi([{ word: 'x' }])).not.toThrow()
  })

  it('phonetics 非数组不抛异常', () => {
    expect(() => parseDictApi([{ phonetics: 'oops' }])).not.toThrow()
  })
})
