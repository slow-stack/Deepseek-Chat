import assert from 'node:assert/strict'
import { test } from 'node:test'

;(globalThis as unknown as { __API_ORIGIN__: string }).__API_ORIGIN__ =
  'https://api.deepseek.com'

const { pickDigestPending } = await import('../memoryDigest.js')
const { digestMemoryId } = await import('../memoryDigest.js')
const { isMemoryEnabled } = await import('../memory.js')
const { setNewSessionMemoryEnabled, takeNewSessionMemoryEnabled, useNewSessionMemory } =
  await import('../newSessionMemory.js')

const summary = (id: string, updatedAt: number, memoryEnabled?: boolean) => ({
  id,
  title: id,
  createdAt: 0,
  updatedAt,
  ...(memoryEnabled === undefined ? {} : { memoryEnabled }),
})

test('默认开启：没设过记忆开关的会话照旧参与整理', () => {
  assert.equal(isMemoryEnabled(undefined), true, '没有会话（新对话）时按开启处理')
  assert.equal(isMemoryEnabled({}), true, '会话上没有这个字段时按开启处理')
  assert.equal(isMemoryEnabled({ memoryEnabled: true }), true)
  assert.equal(isMemoryEnabled({ memoryEnabled: false }), false)
})

test('关闭记忆的会话不进待整理名单', () => {
  const pending = pickDigestPending(
    [summary('open', 3), summary('closed', 2, false), summary('legacy', 1)],
    new Set()
  )
  assert.deepEqual(
    pending.map((item) => item.id),
    ['open', 'legacy'],
    '关掉的会话必须被挡在外面，否则会自动被沉淀进记忆库'
  )
})

test('整理过的会话不再出现在名单里', () => {
  const pending = pickDigestPending(
    [summary('done', 3), summary('todo', 2)],
    new Set([digestMemoryId('done')])
  )
  assert.deepEqual(
    pending.map((item) => item.id),
    ['todo']
  )
})

test('名单按最近改过的排前面', () => {
  const pending = pickDigestPending(
    [summary('old', 1), summary('newest', 9), summary('mid', 5)],
    new Set()
  )
  assert.deepEqual(
    pending.map((item) => item.id),
    ['newest', 'mid', 'old']
  )
})

test('全部关掉时名单是空的，不会退回去整理已关闭的会话', () => {
  const pending = pickDigestPending([summary('a', 2, false), summary('b', 1, false)], new Set())
  assert.deepEqual(pending, [])
})

test('新对话的记忆意愿默认开，取走后复位，不会粘到下一个新对话', () => {
  setNewSessionMemoryEnabled(true)
  assert.equal(takeNewSessionMemoryEnabled(), true)
  setNewSessionMemoryEnabled(false)
  assert.equal(takeNewSessionMemoryEnabled(), false)
  assert.equal(
    useNewSessionMemory.getState().enabled,
    true,
    '取走之后必须复位，否则一次「关」会让之后每个新对话都静默不记忆'
  )
  assert.equal(takeNewSessionMemoryEnabled(), true, '下一个新对话回到默认开启')
})
