/**
 * 切句测试向量。网页与 desktop/ 各存一份副本（只复制数据，不互相引用），
 * 规则变更时两边同步修改，保证两份实现行为一致。
 */

export interface LongExpectation {
  maxLength: number
  contains: string
  /** 左侧是否被截断（以 … 开头） */
  leading: boolean
  /** 右侧是否被截断（以 … 结尾） */
  trailing: boolean
}

export interface SentenceVector {
  name: string
  text: string
  /** 选区 = text 中该子串第一次出现的位置（走 sentenceAt） */
  select?: string
  /** 目标词形（走 sentenceOf） */
  surface?: string
  expected: string | null | LongExpectation
}

const longText = 'Lead in. ' + 'word '.repeat(180) + 'target ' + 'word '.repeat(60) + 'end.'
const longHead = 'Short one. Early target ' + 'word '.repeat(200) + 'end.'

export const SENTENCE_VECTORS: SentenceVector[] = [
  {
    name: '段落中间的句子',
    text: 'I like tea. The ubiquitous phones distract us. We know.',
    select: 'ubiquitous',
    expected: 'The ubiquitous phones distract us.',
  },
  {
    name: '换行分隔',
    text: 'Title line\nThe word is here',
    select: 'word',
    expected: 'The word is here',
  },
  {
    name: '只有一句且无结尾标点',
    text: 'just a fragment with ephemeral',
    select: 'ephemeral',
    expected: 'just a fragment with ephemeral',
  },
  {
    name: '缩写 e.g. 不断句',
    text: 'Use tools, e.g. linters, to enforce style.',
    select: 'enforce',
    expected: 'Use tools, e.g. linters, to enforce style.',
  },
  {
    name: '缩写 Dr. 不断句（大小写不敏感）',
    text: 'Ask Dr. Smith about it. He knows.',
    select: 'Smith',
    expected: 'Ask Dr. Smith about it.',
  },
  {
    name: '缩写 U.S. 不断句',
    text: 'The U.S. economy grew fast. Others lagged.',
    select: 'economy',
    expected: 'The U.S. economy grew fast.',
  },
  {
    name: '缩写 etc. 不断句',
    text: 'Apples, pears, etc. are cheap here. Buy some.',
    select: 'cheap',
    expected: 'Apples, pears, etc. are cheap here.',
  },
  {
    name: '小数不断句',
    text: 'Version 3.14 deprecated the flag.',
    select: 'deprecated',
    expected: 'Version 3.14 deprecated the flag.',
  },
  {
    name: '首字母缩写不断句',
    text: 'Written by J. K. Rowling in Edinburgh. It sold well.',
    select: 'Rowling',
    expected: 'Written by J. K. Rowling in Edinburgh.',
  },
  {
    name: '省略号后跟小写不断句',
    text: 'Wait... then it broke. Fine.',
    select: 'broke',
    expected: 'Wait... then it broke.',
  },
  {
    name: '省略号后跟大写断句',
    text: 'Wait... Then it broke.',
    select: 'broke',
    expected: 'Then it broke.',
  },
  {
    name: 'Unicode 省略号后跟小写不断句',
    text: 'Well… maybe later. Okay.',
    select: 'maybe',
    expected: 'Well… maybe later.',
  },
  {
    name: '中文句末标点无需后跟空白',
    text: '这是第一句。这里有 API 调用！最后一句？',
    select: 'API',
    expected: '这里有 API 调用！',
  },
  {
    name: '问号与感叹号',
    text: 'Is it stale? Yes! Refresh the cache now.',
    select: 'cache',
    expected: 'Refresh the cache now.',
  },
  {
    name: '分号不断句',
    text: 'It is fast; it is cheap. Done.',
    select: 'cheap',
    expected: 'It is fast; it is cheap.',
  },
  {
    name: '句末标点后的右引号归前一句',
    text: 'He said "stop." Then he left.',
    select: 'left',
    expected: 'Then he left.',
  },
  {
    name: 'surface 出现在第二句',
    text: 'Cats sleep. Dogs are running fast.',
    surface: 'running',
    expected: 'Dogs are running fast.',
  },
  {
    name: 'surface 不匹配词的一部分',
    text: 'The carpet is red. A car stops.',
    surface: 'car',
    expected: 'A car stops.',
  },
  {
    name: 'surface 撇号视为词内字符',
    text: "The dog's bone. A dog barks.",
    surface: 'dog',
    expected: 'A dog barks.',
  },
  {
    name: 'surface 大小写不敏感',
    text: 'Fine. Idempotent APIs are nice.',
    surface: 'idempotent',
    expected: 'Idempotent APIs are nice.',
  },
  {
    name: 'surface 取第一次出现',
    text: 'One stale cache. Two stale caches.',
    surface: 'stale',
    expected: 'One stale cache.',
  },
  {
    name: 'surface 找不到',
    text: 'Nothing to see here.',
    surface: 'zebra',
    expected: null,
  },
  {
    name: '弹窗 spec：Word 段落收藏',
    text: 'First point. The approach is pragmatic and fast. Done.',
    surface: 'pragmatic',
    expected: 'The approach is pragmatic and fast.',
  },
  {
    name: '网页 spec：难词在第二句',
    text: 'It works. The protocol is idempotent by design.',
    surface: 'idempotent',
    expected: 'The protocol is idempotent by design.',
  },
  {
    name: '超长句以目标词为中心截取',
    text: longText,
    surface: 'target',
    expected: { maxLength: 500, contains: 'target', leading: true, trailing: true },
  },
  {
    name: '超长句目标词靠前只截右侧',
    text: longHead,
    surface: 'target',
    expected: { maxLength: 500, contains: 'Early target', leading: false, trailing: true },
  },
]
