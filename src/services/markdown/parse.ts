import type { Node as MdAstNode, Nodes, Parent, RootContent, Root, Text } from 'mdast'
import { findAndReplace } from 'mdast-util-find-and-replace'
import { fromMarkdown } from 'mdast-util-from-markdown'
import { gfmFromMarkdown } from 'mdast-util-gfm'
import { mathFromMarkdown } from 'mdast-util-math'
import { gfm } from 'micromark-extension-gfm'
import { math } from 'micromark-extension-llm-math'
import type { Source } from '../chat/view.js'

/** 正文里的 [citation:N]，已换成对应来源 */
export interface CitationNode extends MdAstNode {
  type: 'citation'
  source: Source
}

declare module 'mdast' {
  interface RootContentMap {
    citation: CitationNode
  }

  interface PhrasingContentMap {
    citation: CitationNode
  }
}

const text = (value: string): Text => ({ type: 'text', value })

/**
 * 标题后没空格（模型常写「###小结」）时补一个。
 * CommonMark 要求 `#` 与标题文字之间有空格，缺了整行就当普通段落。
 * 围栏代码块里的 `#` 是注释，不能碰，所以按行跟踪围栏状态。
 */
const fixHeadings = (input: string): string => {
  let fence: string | null = null
  return input
    .split('\n')
    .map((line) => {
      const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)
      if (marker) {
        if (fence === null) {
          fence = marker[1][0]
        } else if (marker[1][0] === fence) {
          fence = null
        }
        return line
      }
      if (fence !== null) {
        return line
      }
      return line.replace(/^ {0,3}(#{1,6})(?=[^\s#])/, '$1 ')
    })
    .join('\n')
}

/** 定界符两侧有中文/标点时 CommonMark 不认为它能闭合，这里按行内配对补回来 */
const EMPHASIS_PATTERNS: Array<{
  pattern: RegExp
  type: 'strong' | 'delete'
  accept?: (content: string) => boolean
}> = [
  { pattern: /\*\*(?=\S)(.+?)(?<=\S)\*\*/g, type: 'strong' },
  {
    // `__粗__文字` 这种紧邻中文的写法 CommonMark 不认，补上；
    // 但内容全是 ASCII 的（`__init__`、`foo__bar__baz`）是标识符不是加粗，放过。
    pattern: /(?<![A-Za-z0-9_])__(?=\S)(.+?)(?<=\S)__(?![A-Za-z0-9_])/g,
    type: 'strong',
    accept: (content) => /[^\u0020-\u007E]/.test(content),
  },
  { pattern: /~~(?=\S)(.+?)(?<=\S)~~/g, type: 'delete' },
]

/**
 * 把一段纯文本里没被解析器认出来的 `**粗体**` / `~~删除~~` 拆成节点。
 * 只在 text 节点上做，代码块与行内代码是别的节点类型，不会被误伤；
 * 定界符跨行（模型真的没写完）时不配对，原样留着。
 * `__粗体__` 不补：CommonMark 本来就不认 intraword 写法，硬补会把 `__init__` 改坏。
 */
const splitEmphasis = (value: string): Nodes[] => {
  let nodes: Nodes[] = [text(value)]
  for (const { pattern, type, accept } of EMPHASIS_PATTERNS) {
    nodes = nodes.flatMap((node) => {
      if (node.type !== 'text') {
        return [node]
      }
      const parts: Nodes[] = []
      let last = 0
      for (const match of node.value.matchAll(pattern)) {
        if (accept && !accept(match[1])) {
          continue
        }
        const start = match.index
        if (start > last) {
          parts.push(text(node.value.slice(last, start)))
        }
        parts.push({ type, children: [text(match[1])] } as Nodes)
        last = start + match[0].length
      }
      if (last === 0) {
        return [node]
      }
      if (last < node.value.length) {
        parts.push(text(node.value.slice(last)))
      }
      return parts
    })
  }
  return nodes
}

/**
 * 解析正文，并把渲染器不单独处理的节点提前换掉，渲染时无需再读原文：
 * - 传入 sources 时，[citation:N] 换成角标节点，找不到来源的直接去掉
 * - disableLink 时链接只保留文字
 * - 删除线保留原样的 ~ 定界符，脚注、引用式链接与定义显示原文
 */
export function toMdAst(
  input: string,
  { sources, disableLink }: { sources: Source[] | undefined; disableLink: boolean }
): Root {
  const ast = fromMarkdown(fixHeadings(input), {
    extensions: [
      // codeIndented 语法导致有前导空格的列表无法正常渲染
      { ...gfm(), disable: { null: ['codeIndented'] } },
      math({ singleDollarTextMath: true }),
    ],
    mdastExtensions: [gfmFromMarkdown(), mathFromMarkdown()],
  })
  if (sources) {
    const sourcesByIndex = new Map(sources.map((source) => [source.index, source]))
    findAndReplace(
      ast,
      [
        /\[citation:(\d+)\]/g,
        (_: string, index: string): CitationNode | '' => {
          const source = sourcesByIndex.get(Number(index))
          return source ? { type: 'citation', source } : ''
        },
      ],
      { ignore: ['linkReference'] }
    )
  }
  const raw = (node: Nodes) => input.slice(node.position?.start.offset, node.position?.end.offset)
  // 先处理子节点，再按需把当前节点换成若干节点
  const simplify = (node: Nodes): Nodes[] => {
    if ('children' in node) {
      ;(node as Parent).children = node.children.flatMap(simplify) as RootContent[]
    }
    switch (node.type) {
      case 'link':
        return disableLink ? node.children : [node]
      case 'text':
        // 定界符紧邻中文或标点时 CommonMark 不闭合，按行内配对补回来
        return splitEmphasis(node.value)
      case 'footnoteReference':
      case 'imageReference':
      case 'linkReference':
        return [text(raw(node))]
      case 'footnoteDefinition':
      case 'definition':
        return [{ type: 'paragraph', children: [text(raw(node))] }]
      default:
        return [node]
    }
  }
  simplify(ast)
  return ast
}
