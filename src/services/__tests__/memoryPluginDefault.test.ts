import assert from 'node:assert/strict'
import { test } from 'node:test'

import { resolveMemoryPluginEnabled } from '../settings.js'

/**
 * 记忆插件默认开着：换台电脑、清一次站点数据，打开就该有记忆入口，
 * 不用先去设置页填一个可选的服务地址。只有用户主动关过才保持关闭。
 */

test('从没存过值时默认开启', () => {
  assert.equal(resolveMemoryPluginEnabled(null), true)
})

test('用户显式关过（存了 false）时保持关闭，不会被默认值覆盖回来', () => {
  assert.equal(resolveMemoryPluginEnabled('false'), false)
})

test('用户显式开过（存了 true）时是开启', () => {
  assert.equal(resolveMemoryPluginEnabled('true'), true)
})

test('存了无法识别的旧值也不当作关闭，按默认可用来算', () => {
  assert.equal(resolveMemoryPluginEnabled(''), true)
  assert.equal(resolveMemoryPluginEnabled('yes'), true)
})
