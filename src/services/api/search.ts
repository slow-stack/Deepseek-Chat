import { ApiError, request, resolveEndpointFor } from './client.js'
import type { WebSearchResult } from './types.js'

/**
 * 独立的联网搜索接口（`POST /v1/tools/search`）。
 *
 * 与对话请求里的 `deepseek_web_search` 服务端工具是两条路：这一条由客户端自己发，
 * 所以可以用别的地址、别的密钥，也可以指向第三方。只有在设置里给「联网搜索」
 * 配了东西时才走这里，否则仍然交给服务端做。
 *
 * 鉴权是 `Authorization: Bearer`，不是对话接口那种 `x-api-key`。
 */

/** 接口原样返回的一条结果，字段比客户端的 WebSearchResult 多几个 */
type SearchApiResult = {
  rerank_score?: number
  title?: string
  url?: string
  snippet?: string
  summary?: string
  content?: string
  site_name?: string | null
  site_icon?: string | null
  date?: string | null
  authority?: number
}

type SearchApiResponse = { results?: SearchApiResult[] }

export type SearchOptions = {
  /** 全局 API Key；该能力配了自己的密钥时以配置为准 */
  apiKey: string
  query: string
  /** 返回条数，1~50，官方默认 10 */
  count?: number
  /** 是否要完整正文（额外计费不变，但响应更大） */
  needContent?: boolean
  signal?: AbortSignal
}

/** 接口时间形如 2026-11-16T00:00:00Z；客户端只展示日期，取不到就是 null */
const readPageAge = (date: string | null | undefined): string | null => date || null

/**
 * 调一次搜索。返回的形状与对话里服务端工具回调的一致，
 * 这样界面渲染、来源编号都不用为两条路各写一套。
 *
 * `encrypted_content` 是服务端工具专有的加密摘要，独立接口没有，置空串。
 */
export const searchWeb = async ({
  apiKey,
  query,
  count = 10,
  needContent = false,
  signal,
}: SearchOptions): Promise<WebSearchResult[]> => {
  const endpoint = resolveEndpointFor('search', apiKey)
  const response = await request(`${endpoint.origin}/v1/tools/search`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${endpoint.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, count, need_content: needContent }),
    signal,
  })
  const body = (await response.json()) as SearchApiResponse
  const results = Array.isArray(body.results) ? body.results : []
  return results.flatMap((item): WebSearchResult[] => {
    if (!item.url) {
      return []
    }
    return [
      {
        type: 'web_search_result',
        title: item.title || item.url,
        url: item.url,
        snippet: item.snippet || item.summary || '',
        summary: item.summary || undefined,
        site_icon: item.site_icon || null,
        site_name: item.site_name || null,
        encrypted_content: '',
        page_age: readPageAge(item.date),
      },
    ]
  })
}

/**
 * 搜索结果转成一段给模型读的 Markdown。
 * 模型看不到界面上的来源卡片，只能读这段文字，所以标题和链接必须写全。
 */
export const formatSearchResults = (results: WebSearchResult[]): string =>
  results
    .map((item, index) => {
      const lines = [`[${index + 1}] ${item.title}`, item.url]
      const body = item.summary || item.snippet
      if (body) {
        lines.push(body)
      }
      if (item.page_age) {
        lines.push(`发布时间：${item.page_age}`)
      }
      return lines.join('\n')
    })
    .join('\n\n')

/** 搜索失败时不打断整轮对话：把原因写进给模型的说明里，让模型自己决定怎么说 */
export const describeSearchFailure = (error: unknown): string => {
  if (error instanceof ApiError) {
    return error.localMessage ? error.message : `${error.kind}${error.status ? ` ${error.status}` : ''}`
  }
  return error instanceof Error ? error.message : String(error)
}
