import { useSettings } from '../settings.js'

/** 记忆库里的一条记忆，字段对齐 mneme standalone API 的 DTO */
export type MemoryRecord = {
  id: string
  type: string
  title: string
  content: string
  tags: string[]
  importance: number | null
  source: string | null
  createdAt: string | null
  occurredAt: string | null
  score: number | null
}

/** 一页结果；total 只在列表模式下有，检索模式给 null */
export type MemoryPage = {
  items: MemoryRecord[]
  total: number | null
  mode: string | null
}

export type MemoryQuery = {
  /** 检索词；留空就是按时间倒序列出 */
  query?: string
  limit?: number
  offset?: number
}

/** 宿主代转的读取入口；只在 DSH 面板里存在 */
const HOST_ENDPOINT = '/api/dsh-chat-demo/memories'

/** 没配记忆服务地址、又不在宿主里跑时抛这个，界面据此提示去设置里填地址 */
export class MemoryServiceMissing extends Error {
  constructor() {
    super('memory service is not configured')
    this.name = 'MemoryServiceMissing'
  }
}

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null

const normalizeRecord = (raw: Record<string, unknown>): MemoryRecord => ({
  id: String(raw.id ?? ''),
  type: typeof raw.type === 'string' ? raw.type : 'unknown',
  title: typeof raw.title === 'string' ? raw.title : '',
  content: typeof raw.content === 'string' ? raw.content : '',
  tags: Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === 'string') : [],
  importance: asNumber(raw.importance),
  source: asString(raw.source),
  createdAt: asString(raw.created_at) ?? asString(raw.createdAt),
  occurredAt: asString(raw.occurred_at) ?? asString(raw.occurredAt),
  score: asNumber(raw._score) ?? asNumber(raw.score),
})

const buildUrl = (query: MemoryQuery) => {
  const { memoryServiceUrl } = useSettings.getState()
  const text = query.query?.trim() ?? ''
  const limit = query.limit ?? 20
  const offset = query.offset ?? 0
  if (memoryServiceUrl) {
    const base = memoryServiceUrl.replace(/\/+$/, '')
    return text
      ? `${base}/search?q=${encodeURIComponent(text)}&topK=${limit}`
      : `${base}/memories?limit=${limit}&offset=${offset}&order=desc`
  }
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
  if (text) {
    params.set('q', text)
  }
  return `${HOST_ENDPOINT}?${params.toString()}`
}

/**
 * 读记忆：填了记忆服务地址就直连（APK / 浏览器都行），
 * 没填就走宿主代转（只在 DSH 面板里有效）。
 */
export const loadMemories = async (query: MemoryQuery = {}): Promise<MemoryPage> => {
  const { memoryServiceUrl, memoryServiceToken } = useSettings.getState()
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  let response: Response
  try {
    response = await fetch(buildUrl(query), {
      method: 'GET',
      headers: memoryServiceUrl
        ? {
            accept: 'application/json',
            ...(memoryServiceToken ? { authorization: `Bearer ${memoryServiceToken}` } : {}),
          }
        : { accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    })
  } catch {
    throw new Error('memory service unreachable')
  } finally {
    clearTimeout(timer)
  }
  if (response.status === 404) {
    throw new MemoryServiceMissing()
  }
  if (!response.ok) {
    throw new Error(`memory service responded ${response.status}`)
  }
  const body = (await response.json()) as Record<string, unknown>
  const rawItems = Array.isArray(body.items)
    ? body.items
    : Array.isArray(body.results)
      ? body.results
      : []
  const items = rawItems
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => normalizeRecord(item.memory && typeof item.memory === 'object' ? (item.memory as Record<string, unknown>) : item))
  return {
    items,
    total: asNumber(body.total),
    mode: typeof body.mode === 'string' ? body.mode : null,
  }
}