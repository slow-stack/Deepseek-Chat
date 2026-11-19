import assert from 'node:assert/strict'
import { test } from 'node:test'

;(globalThis as unknown as { __API_ORIGIN__: string }).__API_ORIGIN__ =
  'https://api.deepseek.com'

const { pickMemories } = await import('../memoryPrompt.js')

/** 造一批按相关度排好序的「记忆」；内容就是序号，便于直接断言挑了哪几条。 */
const ranked = (n: number) => Array.from({ length: n }, (_, i) => `m${i}`)

test('首次生成（attempt 0）恒取前 limit 条，不做任何轮换', () => {
  const items = ranked(10)
  assert.deepEqual(pickMemories(items, 0, 6), ['m0', 'm1', 'm2', 'm3', 'm4', 'm5'])
})

test('候选不够 limit 条时原样返回，不会因为想轮换而丢条', () => {
  const items = ranked(3)
  assert.deepEqual(pickMemories(items, 2, 6), ['m0', 'm1', 'm2'])
})

test('重新生成时最相关的那几条始终保留，不会被轮换挤掉', () => {
  const items = ranked(10)
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const picked = pickMemories(items, attempt, 6)
    assert.deepEqual(picked.slice(0, 4), ['m0', 'm1', 'm2', 'm3'], `第 ${attempt} 次动了保留区`)
  }
})

test('重新生成真的换材料：相邻两次挑到的组合不同', () => {
  const items = ranked(10)
  const first = pickMemories(items, 1, 6)
  const second = pickMemories(items, 2, 6)
  assert.notDeepEqual(first, second, '两次重来挑到同一批记忆，模型只能在措辞上做文章')
})

test('第一次重来就不会和原答案拿同一批记忆（起点不能是 0 号）', () => {
  const items = ranked(10)
  const original = pickMemories(items, 0, 6)
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    assert.notDeepEqual(
      pickMemories(items, attempt, 6),
      original,
      `第 ${attempt} 次重来拿到的还是首次生成那批，等于没换`
    )
  }
})

test('轮换只从保留线之后的候选窗里取，且取满 ROTATE_SLOTS 条', () => {
  const items = ranked(10)
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    const picked = pickMemories(items, attempt, 6)
    assert.equal(picked.length, 6, `第 ${attempt} 次挑出的条数不对`)
    /** 保留区之后的名额必须来自 ranked[4..8) 这个窗口 */
    for (const item of picked.slice(4)) {
      const index = Number(item.slice(1))
      assert.ok(index >= 4 && index < 8, `第 ${attempt} 次挑到了窗口外的 ${item}`)
    }
  }
})

test('同一次重来两次调用结果一致（可复现，不用随机数）', () => {
  const items = ranked(10)
  assert.deepEqual(pickMemories(items, 3, 6), pickMemories(items, 3, 6))
})

test('窗口绕回：attempt 超过窗口宽度时环回，不越界也不缺条', () => {
  const items = ranked(10)
  for (let attempt = 1; attempt <= 20; attempt += 1) {
    const picked = pickMemories(items, attempt, 6)
    assert.equal(new Set(picked).size, 6, `第 ${attempt} 次出现重复条目`)
  }
})

test('limit 小于等于 ROTATE_SLOTS 时退化为不轮换，不返回空数组', () => {
  const items = ranked(5)
  assert.deepEqual(pickMemories(items, 3, 2), ['m0', 'm1'])
  assert.deepEqual(pickMemories(items, 3, 1), ['m0'])
})
