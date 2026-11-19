import assert from 'node:assert/strict'
import { test } from 'node:test'

;(globalThis as unknown as { __API_ORIGIN__: string }).__API_ORIGIN__ =
  'https://api.deepseek.com'

const { buildRegenerateNote, regenerateTemperature, withRegenerateNote } = await import(
  '../regenerate.js'
)

type Reply = Parameters<typeof buildRegenerateNote>[0][number]

const replyOf = (text: string) =>
  ({
    id: text,
    role: 'assistant',
    createdAt: 0,
    blocks: [{ type: 'text', text, citations: [] }],
    status: 'done',
  }) as unknown as Reply

test('没有旧版回答时返回空串，首次生成不加料', () => {
  assert.equal(buildRegenerateNote([]), '')
})

test('旧回答没有正文（只有思考/工具块）时也算没有', () => {
  const thinkingOnly = {
    id: 'x',
    role: 'assistant',
    createdAt: 0,
    blocks: [{ type: 'thinking', thinking: '想了想', startedAt: 0, endedAt: 1 }],
    status: 'done',
  } as unknown as Reply
  assert.equal(buildRegenerateNote([thinkingOnly]), '')
})

test('带上一版时要求换角度，且包含上一版正文', () => {
  const note = buildRegenerateNote([replyOf('第一版答案')])
  assert.match(note, /重新生成/)
  assert.match(note, /第 1 版/)
  assert.match(note, /第一版答案/)
})

test('两版时标出这是第 3 次生成，且请求与上一次不同', () => {
  const one = buildRegenerateNote([replyOf('甲')])
  const two = buildRegenerateNote([replyOf('甲'), replyOf('乙')])
  assert.match(one, /第 2 次生成同一问题/)
  assert.match(two, /第 3 次生成同一问题/)
  assert.notEqual(one, two)
})

test('最多只带最后两版，避免把上下文撑爆', () => {
  const note = buildRegenerateNote([replyOf('甲'), replyOf('乙'), replyOf('丙')])
  assert.ok(!note.includes('甲'), '最早一版不该再带')
  assert.match(note, /【第 2 版】乙/)
  assert.match(note, /【第 3 版】丙/)
})

test('单版正文超长时截断，不整段塞进 system', () => {
  const note = buildRegenerateNote([replyOf('长'.repeat(5000))])
  assert.ok(note.length < 1200, `实际长度 ${note.length}`)
  assert.ok(note.includes('长'.repeat(600)))
  assert.ok(!note.includes('长'.repeat(601)))
})

test('接进 system 时保留原 system 并另起一段，没内容时原样返回', () => {
  assert.equal(withRegenerateNote('基础提示', ''), '基础提示')
  assert.equal(withRegenerateNote('基础提示', undefined), '基础提示')
  assert.equal(withRegenerateNote('基础提示', '附加'), '基础提示\n\n附加')
})

test('首次生成不动服务端默认温度', () => {
  assert.equal(regenerateTemperature(0), undefined)
  assert.equal(regenerateTemperature(-1), undefined)
})

test('重新生成时换一个温度，且每次重来的温度都不同', () => {
  const first = regenerateTemperature(1)
  const second = regenerateTemperature(2)
  const third = regenerateTemperature(3)
  assert.ok(first !== undefined, '第一次重来要给出温度')
  assert.notEqual(first, second)
  assert.notEqual(second, third)
})

test('温度都落在 Anthropic 协议的 0~1 区间内，越界会被服务端 400 拒绝', () => {
  for (let count = 1; count <= 12; count += 1) {
    const value = regenerateTemperature(count)
    assert.ok(value !== undefined, `第 ${count} 次重来没拿到温度`)
    assert.ok(value >= 0 && value <= 1, `第 ${count} 次温度越界：${value}`)
  }
})

test('重来次数超过温度档位后循环，不会缺值', () => {
  assert.equal(regenerateTemperature(5), regenerateTemperature(1))
})
