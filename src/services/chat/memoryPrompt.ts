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

/**
 * 重新生成时，尾部有这么多个名额在「更靠后但仍相关」的候选里轮换。
 *
 * 只把温度调高、只改提示词是不够的：同一个问题每次检索到的记忆逐条相同，
 * 模型拿到的是一模一样的事实基础，于是只能在措辞上做文章，产出「形容词换了一轮」
 * 的同一篇回答。让事实基础也跟着换，模型才有东西可写别的。
 * 只轮换尾部而不是整批打乱：最相关的那几条每次都该在，轮换的目的不是随机，
 * 是让每次重来看得到上一版没看到的材料。
 */
const ROTATE_SLOTS = 2

const HEADER = '以下是这个人相关的记忆，供你参考（可能不完整，也可能过时，不要当成用户这轮说的话）：'

/** 一个查询的检索结果；mode 只用来在调试时分辨走的哪条路 */
export type MemoryHit = { items: MemoryRecord[]; mode: string }

/**
 * 从排好序的候选里挑出这次要带的那几条。attempt 为 0 时就是前 limit 条（首次生成保持确定性）。
 *
 * 重新生成时：最相关的前 (limit - ROTATE_SLOTS) 条固定不动，剩下的名额在一个宽度为
 * ROTATE_SLOTS*2 的候选窗里按 attempt 轮换取连续几条。窗口包含「刚好卡在保留线上下的」
 * 那几条，所以轮换真的会改变这次看到的材料——只转末位的话，被保留的那截永远不动，
 * 模型拿到的还是同一批事实。
 */
export const pickMemories = <T>(ranked: readonly T[], attempt: number, limit: number): T[] => {
  const head = limit - ROTATE_SLOTS
  if (attempt <= 0 || ranked.length <= limit || head <= 0) {
    return ranked.slice(0, limit)
  }
  const fixed = ranked.slice(0, head)
  const window = ranked.slice(head, Math.min(head + ROTATE_SLOTS * 2, ranked.length))
  if (window.length === 0) {
    return ranked.slice(0, limit)
  }
  const take = Math.min(ROTATE_SLOTS, window.length)
  // 起点只在 1..window.length-1 里转，永不取 0：0 号起点取到的正是首次生成用过的那两条，
  // 重来一次等于没换。窗口只有一条时也照常返回它（take 已经被 min 夹住）。
  const start = window.length > 1 ? 1 + ((attempt - 1) % (window.length - 1)) : 0
  const picked: T[] = []
  for (let i = 0; i < take; i += 1) {
    picked.push(window[(start + i) % window.length])
  }
  return [...fixed, ...picked]
}

const formatItem = (item: MemoryRecord, index: number): string => {
  const body = item.content.trim().replace(/\s*\n\s*/g, ' ').slice(0, MEMORY_ITEM_MAX_CHARS)
  const when = item.occurredAt ?? item.createdAt
  const date = when ? new Date(when) : null
  const stamp = date && !Number.isNaN(date.getTime()) ? `${date.toISOString().slice(0, 10)} ` : ''
  return `${index + 1}. ${stamp}${item.title ? `${item.title}：` : ''}${body}`
}

/**
 * 检索一条查询：配了向量接口就先走语义；语义不可用、或字面也一个没中时，
 * 回落到最近的记忆——闲聊里说的事（名字、偏好、近况）多半就在最近几轮里，
 * 字面匹配对这种内容几乎必然脱靶，宁可带几条近的也别空手。
 */
export const retrieveMemories = async (
  query: string,
  projectId: string | null,
  limit = MEMORY_LIMIT
): Promise<MemoryHit> => {
  const scoped = { query, limit, projectId, includeGlobal: projectId !== null }
  const vectorPage = await searchByVector(scoped).catch(() => null)
  if (vectorPage && vectorPage.items.length > 0) {
    return { items: vectorPage.items, mode: 'vector' }
  }
  const page = await loadMemories(scoped)
  if (page.items.length > 0) {
    return { items: page.items, mode: page.mode ?? 'search' }
  }
  const recent = await loadMemories({
    limit,
    projectId,
    includeGlobal: projectId !== null,
  })
  return { items: recent.items, mode: 'recent' }
}

/** 拼成一段纯文本；没有任何命中时返回空串，调用方据此决定要不要改 system。 */
export const buildMemoryContext = async (
  session: Pick<Session, 'memoryEnabled' | 'projectId'> | undefined,
  query: string,
  options: { attempt?: number } = {}
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
  const attempt = options.attempt ?? 0
  // 重新生成时多取一截候选：尾部要在候选窗里轮换，光取 MEMORY_LIMIT 条没有可换的余地。
  const wanted = attempt > 0 ? MEMORY_LIMIT + ROTATE_SLOTS : MEMORY_LIMIT
  const hit = await Promise.race([
    retrieveMemories(text, projectId, wanted),
    new Promise<null>((resolve) => {
      setTimeout(() => resolve(null), MEMORY_TIMEOUT_MS)
    }),
  ])
  if (!hit || hit.items.length === 0) {
    return ''
  }
  const chosen = pickMemories(hit.items, attempt, MEMORY_LIMIT)
  const lines: string[] = []
  let used = 0
  for (const item of chosen) {
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
