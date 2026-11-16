import { canReadMemory } from './memory.js'
import { loadMemories } from './memoryRead.js'
import { searchByVector } from './memoryVector.js'
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

/** 取记忆不能拖慢提问：超过这个时间就放弃，按没有记忆发。语义检索要过一次接口，给宽一点。 */
const MEMORY_TIMEOUT_MS = 3000

const HEADER = '以下是这个人相关的记忆，供你参考（可能不完整，也可能过时，不要当成用户这轮说的话）：'

/** 一个查询的检索结果；mode 只用来在调试时分辨走的哪条路 */
export type MemoryHit = { items: MemoryRecord[]; mode: string }

const formatItem = (item: MemoryRecord, index: number): string => {
  const body = item.content.trim().replace(/\s*\n\s*/g, ' ').slice(0, MEMORY_ITEM_MAX_CHARS)
  const when = item.occurredAt ?? item.createdAt
  const date = when ? new Date(when) : null
  const stamp = date && !Number.isNaN(date.getTime()) ? `${date.toISOString().slice(0, 10)} ` : ''
  return `${index + 1}. ${stamp}${item.title ? `${item.title}：` : ''}${body}`
}

/**
 * 检索一条查询：配了向量接口就先走语义，没配或语义不可用回落字面匹配。
 * 字面匹配对自然语言提问命中率很低（面板搜索早就是语义优先），注入不该比面板差。
 */
export const retrieveMemories = async (
  query: string,
  projectId: string | null
): Promise<MemoryHit> => {
  const scoped = { query, limit: MEMORY_LIMIT, projectId, includeGlobal: projectId !== null }
  const vectorPage = await searchByVector(scoped).catch(() => null)
  if (vectorPage && vectorPage.items.length > 0) {
    return { items: vectorPage.items, mode: 'vector' }
  }
  const page = await loadMemories(scoped)
  return { items: page.items, mode: page.mode ?? 'list' }
}

/** 拼成一段纯文本；没有任何命中时返回空串，调用方据此决定要不要改 system。 */
export const buildMemoryContext = async (
  session: Pick<Session, 'memoryEnabled' | 'projectId'> | undefined,
  query: string
): Promise<string> => {
  if (!canReadMemory(session)) {
    return ''
  }
  const text = query.trim()
  if (!text) {
    return ''
  }
  // 会话在项目里时，带这个项目的记忆 + 全局记忆：项目里的事和关于这个人本身的事都该知道，
  // 但不该读到别的项目。不在项目里就只看全局。
  const projectId = session?.projectId ?? null
  const hit = await Promise.race([
    retrieveMemories(text, projectId),
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), MEMORY_TIMEOUT_MS)
    }),
  ])
  if (!hit || hit.items.length === 0) {
    return ''
  }
  const lines: string[] = []
  let used = 0
  for (const item of hit.items.slice(0, MEMORY_LIMIT)) {
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
