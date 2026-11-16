import { useSettings } from '../settings.js'
import {
  clearLocalVectors,
  exportLocalMemories,
  loadLocalVectors,
  saveLocalVector,
} from './memoryStore.js'
import type { MemoryQuery, MemoryPage, MemoryRecord } from './memoryTypes.js'

/**
 * 向量检索：可选的能力，关着的时候一切都和以前一样走字面匹配。
 *
 * 为什么放在客户端自己算：记忆本来就存在这台设备的 IndexedDB 里，
 * 为了「按意思搜」把整库上传到一个服务里说不过去。所以只把要算的文本
 * 发给用户自己填的 embedding 接口，向量也留在本机。
 *
 * 接口形状照 OpenAI 的 /embeddings：POST {model, input: string[]} → {data:[{embedding}]}。
 * mneme 那边也是这套，所以填同一个地址就能用。
 */

/** 一次最多算多少条文本，避免单个请求过大 */
const EMBED_BATCH = 16

/** 请求超时：算向量偶尔会慢，给足 30 秒，再久就当它挂了 */
const TIMEOUT_MS = 30000

export type VectorConfig = {
  enabled: boolean
  baseUrl: string
  model: string
  apiKey: string
}

export const vectorConfig = (): VectorConfig => {
  const state = useSettings.getState()
  return {
    enabled: state.memoryVectorEnabled,
    baseUrl: state.memoryVectorBaseUrl,
    model: state.memoryVectorModel,
    apiKey: state.memoryVectorApiKey,
  }
}

/** 四个字段齐了才能用；缺一个就当没开，跟 mneme 的 configComplete 一致 */
export const vectorReady = (config: VectorConfig = vectorConfig()): boolean =>
  Boolean(config.enabled && config.baseUrl && config.model && config.apiKey)

const embeddingsUrl = (baseUrl: string): string => {
  const base = baseUrl.trim().replace(/\/+$/, '')
  if (!base) {
    return ''
  }
  // 允许填 https://host/v1 或直接填到 /embeddings
  return /\/embeddings$/i.test(base) ? base : `${base}/embeddings`
}

/** 调一次接口算一批文本的向量；任何一步不对就抛，调用方自己决定是不是静默回落 */
export const embedTexts = async (texts: string[], config = vectorConfig()): Promise<number[][]> => {
  const url = embeddingsUrl(config.baseUrl)
  if (!url) {
    throw new Error('vector base url is empty')
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ model: config.model, input: texts }),
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
  if (!response.ok) {
    throw new Error(`embedding responded ${response.status}`)
  }
  const body = (await response.json()) as { data?: unknown }
  if (!Array.isArray(body.data)) {
    throw new Error('embedding response has no data')
  }
  const vectors = body.data.map((item) => {
    const embedding = (item as { embedding?: unknown })?.embedding
    if (!Array.isArray(embedding) || embedding.length === 0) {
      throw new Error('embedding item is empty')
    }
    return embedding.filter((value): value is number => typeof value === 'number')
  })
  if (vectors.length !== texts.length) {
    throw new Error('embedding count mismatch')
  }
  return vectors
}

/** 把要参与语义比对的内容拼成一次输入：标题短、正文长，权重分开写 */
const textOf = (record: MemoryRecord): string =>
  record.title ? `${record.title}\n${record.content}` : record.content

const cosine = (a: number[], b: number[]): number => {
  const length = Math.min(a.length, b.length)
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) {
    return 0
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}

export type ReindexResult = { indexed: number; skipped: number; failed: number }

/**
 * 把还没有向量的记忆补上。已经有向量的跳过，所以反复调用是安全的，
 * 换模型时先清空再补（新旧向量不同源）。
 * 中途失败就停下，已算好的留着，下次接着来。
 */
export const reindexMemories = async (
  config = vectorConfig(),
  onProgress?: (done: number, total: number) => void
): Promise<ReindexResult> => {
  if (!vectorReady(config)) {
    return { indexed: 0, skipped: 0, failed: 0 }
  }
  const records = await exportLocalMemories()
  const existing = new Set((await loadLocalVectors(config.model)).map((item) => item.id))
  const pending = records.filter((record) => !existing.has(record.id))
  const result: ReindexResult = {
    indexed: 0,
    skipped: records.length - pending.length,
    failed: 0,
  }
  for (let start = 0; start < pending.length; start += EMBED_BATCH) {
    const batch = pending.slice(start, start + EMBED_BATCH)
    try {
      const vectors = await embedTexts(batch.map(textOf), config)
      for (let index = 0; index < batch.length; index += 1) {
        await saveLocalVector({ id: batch[index].id, model: config.model, vector: vectors[index] })
        result.indexed += 1
      }
    } catch {
      result.failed += batch.length
      break
    }
    onProgress?.(start + batch.length, pending.length)
  }
  return result
}

/** 换模型或换地址后整表作废；不清的话两种向量会被拿去比距离 */
export const resetVectors = async (): Promise<void> => {
  await clearLocalVectors()
}

/** 一条记忆算一份向量要多少字：太长的正文截断，反正检索靠前半段就够 */
const MAX_EMBED_CHARS = 2000

const queryVector = async (text: string, config: VectorConfig): Promise<number[]> => {
  const [vector] = await embedTexts([text.slice(0, MAX_EMBED_CHARS)], config)
  return vector
}

/**
 * 语义检索：用查询的向量跟本地已有向量比余弦，按分数排。
 * 没有可用向量（没索引过、或接口挂了）时返回 null，让上层回落到字面匹配——
 * 这里绝不因为向量不可用就让「搜索」整个坏掉。
 */
export const searchByVector = async (
  query: MemoryQuery,
  config = vectorConfig()
): Promise<MemoryPage | null> => {
  const text = query.query?.trim() ?? ''
  if (!text || !vectorReady(config)) {
    return null
  }
  let target: number[]
  try {
    target = await queryVector(text, config)
  } catch {
    return null
  }
  const vectors = await loadLocalVectors(config.model)
  if (vectors.length === 0) {
    return null
  }
  const records = await exportLocalMemories()
  const byId = new Map(records.map((record) => [record.id, record]))
  // 归属先筛再算距离：项目会话不该因为别的项目里有一条语义相近的记忆就被喂错上下文
  const inScope = (record: MemoryRecord): boolean => {
    if (query.projectId === undefined) {
      return true
    }
    const own = record.projectId ?? null
    return own === query.projectId || (query.includeGlobal === true && own === null)
  }
  const scored = vectors
    .map((item) => {
      const record = byId.get(item.id)
      return record && inScope(record) ? { record, score: cosine(target, item.vector) } : null
    })
    .filter((item): item is { record: MemoryRecord; score: number } => item !== null)
    .sort((a, b) => b.score - a.score)
  if (scored.length === 0) {
    return null
  }
  const limit = query.limit ?? 20
  const offset = query.offset ?? 0
  const items = scored
    .slice(offset, offset + limit)
    .map(({ record, score }) => ({ ...record, score }))
  return { items, total: scored.length, mode: 'vector' }
}
