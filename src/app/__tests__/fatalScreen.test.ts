import assert from 'node:assert/strict'
import { test } from 'node:test'

// 这个模块在导入时不会碰 DOM，只有真的调用显示函数才会。
const { copyFor } = await import('../fatalScreen.js')

test('兜底页：中文浏览器看到中文，其它看到英文', () => {
  assert.equal(copyFor('zh-CN').title, '页面没能加载出来')
  assert.equal(copyFor('zh').title, '页面没能加载出来')
  assert.equal(copyFor('zh-TW').title, '页面没能加载出来')
  assert.equal(copyFor('en-US').title, 'The page failed to load')
  assert.equal(copyFor('ja-JP').title, 'The page failed to load')
})

test('兜底页：语言缺失时退回中文而不是报错', () => {
  assert.equal(copyFor('').title, '页面没能加载出来')
  assert.equal(copyFor('   ').title, '页面没能加载出来')
  assert.equal(copyFor(undefined as unknown as string).title, '页面没能加载出来')
  assert.equal(copyFor(null as unknown as string).title, '页面没能加载出来')
})

test('兜底页：两套文案都给齐四项，缺一项按钮就没字', () => {
  for (const language of ['zh-CN', 'en-US']) {
    const copy = copyFor(language)
    for (const key of ['title', 'lead', 'retry', 'download'] as const) {
      assert.equal(typeof copy[key], 'string')
      assert.ok(copy[key].length > 0, `${language} ${key} 不能为空`)
    }
  }
})
