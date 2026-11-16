import { canReadMemory } from './memory.js'
import { loadMemories } from './memoryRead.js'
import type { MemoryRecord } from './memoryTypes.js'
import type { Session } from './types.js'

/**
 * 把记忆库里的相关条目拼成一段上下文，接到 system prompt 后面。
 *
 * 为什么不做成工具：客户端没有 tool 循环（不解析 SSE 的 tool_use、不本地执行、
 * 也不把结果回灌给下一轮），要加工具得先把这套跑通，工程量和风险都大得多。
 * 自动注入只要在发请求前多读一次库，对模型来说是「一开始就知道」，
 * 也不占对话轮次，先做这个。
 *
 * 记忆是旁路：整段 try + 超时，失败就当没有记忆，绝不能把一次正常提问变成错误。
 */

/** 最多带几条。太多会把真正的提问挤到很后面，也烧 token。 */
const MEMORY_LIMIT = 6

/** 单条截断长度，避免一条长笔记占满整个上下文。 */
const MEMORY_ITEM_MAX_CHARS = 400

/** 整段记忆最多占多少字，超了从后面砍。 */
const MEMORY_TOTAL_MAX_CHARS = 2000

/** 取记忆不能拖慢提问：超过这个时间就放弃，按没有记忆发。 */
const MEMORY_TIMEOUT_MS = 1000

const HEADER = '以下是这个人相关的记忆，供你参考（可能不完整，也可能过时，不要当成用户这轮说的话）：'

const formatItem = (item: MemoryRecord, index: number): string => {
  const body = item.content.trim().replace(/\s*\n\s*/g, ' ').slice(0, MEMORY_ITEM_MAX_CHARS)
  const when = item.occurredAt ?? item.createdAt
  const date = when ? new Date(when) : null
  const stamp = date && !Number.isNaN(date.getTime()) ? `${date.toISOString().slice(0, 10)} ` : ''
  return `${index + 1}. ${stamp}${item.title ? `${item.title}：` : ''}${body}`
}

/** 拼成一段纯文本；没有任何命中时返回空串，调用方据此决定要不要改 system。 */
export const buildMemoryContext = async (
  session: Pick<Session, 'memoryEnabled'> | undefined,
  query: string
): Promise<string> => {
  if (!canReadMemory(session)) {
    return ''
  }
  const text = query.trim()
  if (!text) {
    return ''
  }
  const page = await Promise.race([
    loadMemories({ query: text, limit: MEMORY_LIMIT }),
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), MEMORY_TIMEOUT_MS)
    }),
  ])
  if (!page || page.items.length === 0) {
    return ''
  }
  const lines: string[] = []
  let used = 0
  for (const item of page.items.slice(0, MEMORY_LIMIT)) {
    const line = formatItem(item, lines.length)
    if (used + line.length > MEMORY_TOTAL_MAX_CHARS) {
      break
    }
    lines.push(line)
    used += line.length
  }
  if (lines.length === 0) {
    return ''
  }
  return `${HEADER}\n${lines.join('\n')}`
}

/** 把记忆接到 system prompt 后面；没有记忆就原样返回。 */
export const withMemoryContext = (system: string, context: string): string =>
  context ? `${system}\n\n${context}` : system
