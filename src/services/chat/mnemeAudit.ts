/**
 * mneme（DSH 侧）的 token 消耗审计读数。
 *
 * 数据源是 dsh-mneme 的 llm_audit_logs 表（每个后台 LLM 调用记一行，
 * 12 种 operation_type 全记账），走插件宿主的代理读：
 * /api/dsh-chat-demo/llm-audit?view=stats|items——token 留在宿主侧，
 * 面板只拿聚合结果，不碰任何密钥。
 */

/** 审计端点；只在插件宿主（同源）里存在，普通 dev 页没有 */
const AUDIT_ENDPOINT = '/api/dsh-chat-demo/llm-audit'

/** mneme 审计里的 operation_type；只挑面板要展示的，未知类型进「其他」 */
export type MnemeAuditOperation =
  | 'summarize_compress'
  | 'dream_consolidate'
  | 'dream_summarize'
  | 'entity_extract'
  | 'pre_inject_gate'
  | 'profile_extract'
  | 'profile_facts'
  | 'sleep_pattern'
  | 'sleep_affective'
  | 'diary_compose'
  | 'write_admission'
  | 'storage_reclaim'

export type MnemeAuditStats = {
  totalCalls: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  /** operation_type → token 总和；接口没给的键不出现 */
  byOperation: Record<string, number>
  /** ISO 日期 → token 总和；画时间线用 */
  byDay: Record<string, number>
  byStatus: Record<string, number>
}

const asNumber = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : 0

const asRecord = (value: unknown): Record<string, number> => {
  if (typeof value !== 'object' || value === null) {
    return {}
  }
  const result: Record<string, number> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    result[key] = asNumber(item)
  }
  return result
}

const normalizeStats = (raw: Record<string, unknown>): MnemeAuditStats => ({
  totalCalls: asNumber(raw.totalCalls ?? raw.total_calls ?? raw.count),
  inputTokens: asNumber(raw.inputTokens ?? raw.input_tokens),
  outputTokens: asNumber(raw.outputTokens ?? raw.output_tokens),
  totalTokens: asNumber(raw.totalTokens ?? raw.total_tokens),
  byOperation: asRecord(raw.byOperation ?? raw.by_operation),
  byDay: asRecord(raw.byDay ?? raw.by_day),
  byStatus: asRecord(raw.byStatus ?? raw.by_status),
})

/** 探测代理端点在不在（普通 dev 页没有宿主代理，面板才有） */
export const mnemeAuditAvailable = async (): Promise<boolean> => {
  try {
    const response = await fetch(`${AUDIT_ENDPOINT}?view=stats&days=1`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(5000),
    })
    return response.ok
  } catch {
    return false
  }
}

/** 按 days 天取聚合；面板的 mneme 分区用 */
export const loadMnemeAuditStats = async (days = 30): Promise<MnemeAuditStats> => {
  const response = await fetch(`${AUDIT_ENDPOINT}?view=stats&days=${days}`, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) {
    throw new Error(`llm-audit responded ${response.status}`)
  }
  const body = (await response.json()) as Record<string, unknown>
  return normalizeStats(body)
}

export type MnemeAuditEntryView = {
  id: string
  operationType: string
  modelId: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  at: string | null
  status: string | null
}

/** 最近几笔明细；流水行用 */
export const loadMnemeAuditEntries = async (limit = 20): Promise<MnemeAuditEntryView[]> => {
  const response = await fetch(`${AUDIT_ENDPOINT}?view=items&limit=${limit}`, {
    headers: { accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) {
    throw new Error(`llm-audit responded ${response.status}`)
  }
  const body = (await response.json()) as Record<string, unknown>
  const rawItems = Array.isArray(body.items)
    ? body.items
    : Array.isArray(body.results)
      ? body.results
      : Array.isArray(body)
        ? body
        : []
  return rawItems
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      id: String(item.id ?? `${item.timestamp ?? ''}:${item.operation_type ?? ''}`),
      operationType: String(item.operationType ?? item.operation_type ?? 'unknown'),
      modelId: String(item.modelId ?? item.model_id ?? ''),
      inputTokens: asNumber(item.inputTokens ?? item.input_tokens),
      outputTokens: asNumber(item.outputTokens ?? item.output_tokens),
      totalTokens: asNumber(item.totalTokens ?? item.total_tokens),
      at: typeof (item.timestamp ?? item.at) === 'string' ? (item.timestamp as string) : null,
      status: typeof item.status === 'string' ? item.status : null,
    }))
}
