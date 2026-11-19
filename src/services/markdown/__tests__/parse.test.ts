import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { Nodes, Parent, Root } from 'mdast'

;(globalThis as unknown as { __API_ORIGIN__: string }).__API_ORIGIN__ =
  'https://api.deepseek.com'

const { toMdAst } = await import('../parse.js')

const parse = (input: string) => toMdAst(input, { sources: undefined, disableLink: false })

/** 把 AST 压成便于断言的一行，例如 paragraph[strong[粗体],文字] */
const shape = (node: Nodes): string => {
  if (node.type === 'text') {
    return node.value
  }
  if ('children' in node) {
    return `${node.type}[${(node as Parent).children.map((child) => shape(child as Nodes)).join(',')}]`
  }
  if ('value' in node) {
    return `${node.type}[${String(node.value)}]`
  }
  return node.type
}

const outline = (ast: Root) => ast.children.map((child) => shape(child as Nodes)).join(' ')

/** 收集所有文本节点，用来确认没被吃掉的定界符 */
const texts = (node: Nodes, out: string[] = []): string[] => {
  if (node.type === 'text') {
    out.push(node.value)
  } else if ('children' in node) {
    for (const child of (node as Parent).children) {
      texts(child as Nodes, out)
    }
  }
  return out
}

test('加粗后紧跟中文时也能闭合（模型最爱写「**结论：**正文」）', () => {
  for (const punctuation of ['：', '。', '，', '！', '？', '；']) {
    const ast = parse(`**结论${punctuation}**正文`)
    assert.equal(
      outline(ast),
      `paragraph[strong[结论${punctuation}],正文]`,
      `「**结论${punctuation}**正文」没有渲染成加粗`
    )
  }
})

test('加粗后紧跟英文时也能闭合', () => {
  assert.equal(outline(parse('**bold:**text')), 'paragraph[strong[bold:],text]')
})

test('下划线加粗在中文里生效，但不误伤 intraword 下划线', () => {
  assert.equal(outline(parse('__粗__文字')), 'paragraph[strong[粗],文字]')
  // CommonMark 里 `__bold__text` 本来就不是加粗（下划线不能 intraword 闭合），
  // 这类写法多半是代码里的 `__init__`、`foo__bar`，硬补会改坏原文。
  assert.equal(outline(parse('__bold__text')), 'paragraph[__bold__text]')
  // `调用 __init__ 方法` 两侧是空格，CommonMark 自己就认成 strong[init]，这是规范行为不是我们的补丁
  assert.equal(outline(parse('调用 __init__ 方法')), 'paragraph[调用 ,strong[init], 方法]')
})

test('删除线渲染成删除线节点，而不是把两个波浪线留在正文里', () => {
  assert.equal(outline(parse('~~删除~~文字')), 'paragraph[delete[删除],文字]')
})

test('单个波浪线是范围写法，不当删除线', () => {
  assert.equal(outline(parse('价格是 100~200 元')), 'paragraph[价格是 100~200 元]')
})

test('标题后不跟空格也能认出来（模型常写「###小结」）', () => {
  assert.equal(outline(parse('###小结')), 'heading[小结]')
  assert.equal(outline(parse('##标题')), 'heading[标题]')
})

test('标题后本来就有空格时行为不变', () => {
  assert.equal(outline(parse('## 标题')), 'heading[标题]')
})

test('代码块里的星号原样保留，不做任何补渲染', () => {
  assert.equal(outline(parse('```\n**不处理**\n```')), 'code[**不处理**]')
})

test('行内代码里的星号原样保留', () => {
  assert.equal(outline(parse('`**x**`')), 'paragraph[inlineCode[**x**]]')
})

test('正常写法不受影响', () => {
  assert.equal(outline(parse('**粗体**文字')), 'paragraph[strong[粗体],文字]')
  assert.equal(outline(parse('*斜体*文字')), 'paragraph[emphasis[斜体],文字]')
  assert.equal(outline(parse('普通文字')), 'paragraph[普通文字]')
})

test('一个段落里多个漏渲染的定界符都能补上', () => {
  const ast = parse('**第一点：**说明 **第二点：**再说明')
  assert.equal(outline(ast), 'paragraph[strong[第一点：],说明 ,strong[第二点：],再说明]')
})

test('补渲染后不残留任何定界符', () => {
  const samples = ['**结论：**正文', '__粗__文字', '~~删除~~文字', '###小结']
  for (const sample of samples) {
    const leftovers = texts(parse(sample)).filter((value) => /\*\*|__|~~|###/.test(value))
    assert.deepEqual(leftovers, [], `「${sample}」里还残留定界符：${leftovers.join('|')}`)
  }
})

test('跨行的定界符交给解析器自己判断，不额外补', () => {
  // CommonMark 允许 strong 跨行，正常闭合时补渲染不该插手
  assert.equal(outline(parse('**第一段\n第二段**')), 'paragraph[strong[第一段\n第二段]]')
  // 只有开头没结尾（模型真没写完）时原样保留，不能凭空造 strong
  assert.equal(texts(parse('**没闭合的第一段')).join(''), '**没闭合的第一段')
})
