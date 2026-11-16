import { useSettings } from '../settings.js'
import { memoryServiceErrorOf } from './memoryEndpoint.js'
import { listLocalMemories } from './memoryStore.js'
import type { MemoryPage, MemoryQuery, MemoryRecord } from './memoryTypes.js'

export type { MemoryPage, MemoryQuery, MemoryRecord } from './memoryTypes.js'

/** 走宿主代转的读取入口；只在 DSH 面板里存在，作为没有本地库时的兜底 */
const HOST_ENDPOINT = '/api/dsh-chat-demo/memories'

/** 记忆默认存在本机；只有用户在高级设置里填了服务地址才改走远端 */
export const usesRemoteMemory = (): boolean =>
  Boolean(useSettings.getState().memoryServiceUrl)

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
  // 远端服务不一定有归属；没有就当全局，界面不用为它单独分支
  projectId: asString(raw.projectId) ?? asString(raw.project_id),
})

const buildUrl = (query: MemoryQuery, base: string) => {
  const text = query.query?.trim() ?? ''
  const limit = query.limit ?? 20
  const offset = query.offset ?? 0
  const trimmed = base.replace(/\/+$/, '')
  // 归属只在明确要看某一栏时才带上参数：不传就是「全部」，远端不必猜
  const scope: string[] = []
  if (query.projectId !== undefined) {
    scope.push(`projectId=${query.projectId === null ? 'null' : encodeURIComponent(query.projectId)}`)
    if (query.includeGlobal) {
      scope.push('includeGlobal=1')
    }
  }
  const suffix = scope.length > 0 ? `&${scope.join('&')}` : ''
  if (text) {
    return `${trimmed}/search?q=${encodeURIComponent(text)}&topK=${limit}${suffix}`
  }
  return `${trimmed}/memories?limit=${limit}&offset=${offset}&order=desc${suffix}`
}

/**
 * 读记忆。默认读本机那个库（装了就有、离线可用）；
 * 只有在高级设置里填了服务地址时才去连远端，连不上就报错，不静默回落到本地，
 * 否则用户以为看的是同一份记忆，其实两份。
 */
export const loadMemories = async (query: MemoryQuery = {}): Promise<MemoryPage> => {
  const { memoryServiceUrl, memoryServiceToken } = useSettings.getState()
  if (!memoryServiceUrl) {
    return listLocalMemories(query)
  }
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  let response: Response
  try {
    response = await fetch(buildUrl(query, memoryServiceUrl), {
      method: 'GET',
      headers: {
        accept: 'application/json',
        ...(memoryServiceToken ? { authorization: `Bearer ${memoryServiceToken}` } : {}),
      },
      signal: controller.signal,
      cache: 'no-store',
    })
  } catch {
    // 区分「明文被设备拦下」与「服务真连不上」：前者用户要改地址，后者才是查服务
    throw memoryServiceErrorOf(memoryServiceUrl)
  } finally {
    clearTimeout(timer)
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
    .map((item) =>
      normalizeRecord(
        item.memory && typeof item.memory === 'object'
          ? (item.memory as Record<string, unknown>)
          : item
      )
    )
  return {
    items,
    total: asNumber(body.total),
    mode: typeof body.mode === 'string' ? body.mode : null,
  }
}

/** 给没有本地库的场景留的兜底入口（宿主面板内直连宿主代转） */
export const loadHostMemories = async (query: MemoryQuery = {}): Promise<MemoryPage> => {
  const params = new URLSearchParams({
    limit: String(query.limit ?? 20),
    offset: String(query.offset ?? 0),
  })
  const text = query.query?.trim()
  if (text) {
    params.set('q', text)
  }
  const response = await fetch(`${HOST_ENDPOINT}?${params.toString()}`, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
  })
  if (!response.ok) {
    throw new Error(`memory service responded ${response.status}`)
  }
  const body = (await response.json()) as Record<string, unknown>
  const rawItems = Array.isArray(body.items) ? body.items : []
  return {
    items: rawItems
      .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
      .map(normalizeRecord),
    total: asNumber(body.total),
    mode: typeof body.mode === 'string' ? body.mode : null,
  }
}
