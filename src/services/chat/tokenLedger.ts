import { openDB, type DBSchema, type IDBPDatabase } from 'idb'

/**
 * Token 台账：把每个会花钱的整理动作记一笔，让「记忆花了多少 token、花在哪」可查。
 *
 * 只记模型侧的消耗，四个去向：
 * - digest 整理会话（抽记忆）
 * - compaction 上下文压缩
 * - profile 用户画像
 * - summary 记忆摘要
 *
 * 能拿到服务端 usage 就记真实值；拿不到（请求失败、旧事件缺 usage）就不记——
 * 宁可账上少一笔，也不放一个估算出来的假数。
 * 估算只作为「这次运行的总和」的兜底（见 ledgerRun），不进逐条台账。
 */

const DB_NAME = 'chat-demo-memory'
const STORE = 'usage'

export type TokenUsageKind = 'digest' | 'compaction' | 'profile' | 'summary'

export type TokenUsageEntry = {
  id: string
  kind: TokenUsageKind
  /** 真实值：服务端 usage 四项之和 */
  input: number
  cacheCreation: number
  cacheRead: number
  output: number
  at: number
}

interface MemoryDB extends DBSchema {
  memories: { key: string; value: unknown }
  vectors: { key: string; value: unknown }
  usage: { key: string; value: TokenUsageEntry; indexes: { at: number } }
}

let dbPromise: Promise<IDBPDatabase<MemoryDB>> | null = null

const getDB = () =>
  (dbPromise ??= openDB<MemoryDB>(DB_NAME, 3, {
    upgrade(db, oldVersion) {
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('at', 'at')
      }
      // 老库从 v1/v2 升上来只补 usage 表，memories / vectors 原封不动
      void oldVersion
    },
  }).catch((error: unknown) => {
    dbPromise = null
    throw error
  }))

/** 四项之和；与 compaction.usageTokens 同一口径 */
export const usageTotal = (entry: Pick<
  TokenUsageEntry,
  'input' | 'cacheCreation' | 'cacheRead' | 'output'
>): number => entry.input + entry.cacheCreation + entry.cacheRead + entry.output

/**
 * 记一笔。调用方只给去向和真实 usage；id 不给就按时间生成，保证不会互相覆盖。
 * 写账失败不抛：台账只是观测，不能反过来打断整理本身。
 */
export const recordTokenUsage = async (
  kind: TokenUsageKind,
  usage: { input_tokens: number; cache_creation_input_tokens: number; cache_read_input_tokens: number; output_tokens: number }
): Promise<void> => {
  try {
    const entry: TokenUsageEntry = {
      id: `${kind}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      kind,
      input: usage.input_tokens,
      cacheCreation: usage.cache_creation_input_tokens,
      cacheRead: usage.cache_read_input_tokens,
      output: usage.output_tokens,
      at: Date.now(),
    }
    await (await getDB()).put(STORE, entry)
  } catch {
    // 台账写不进去就算了，主流程不受影响
  }
}

export type UsageTotals = {
  digest: number
  compaction: number
  profile: number
  summary: number
}

/** 按「去向」分组求和；面板统计行用 */
export const usageTotals = async (): Promise<UsageTotals> => {
  const all = await (await getDB()).getAllFromIndex(STORE, 'at')
  const totals: UsageTotals = { digest: 0, compaction: 0, profile: 0, summary: 0 }
  for (const entry of all) {
    totals[entry.kind] += usageTotal(entry)
  }
  return totals
}

/** 台账里一共几笔；为 0 时面板可以少渲染一块 */
export const countUsageEntries = async (): Promise<number> => (await getDB()).count(STORE)

export type UsageEntryView = TokenUsageEntry & { total: number }

/** 最近几笔，新的在前；面板列表用 */
export const listUsageEntries = async (limit = 20): Promise<UsageEntryView[]> => {
  const all = await (await getDB()).getAllFromIndex(STORE, 'at')
  return all
    .slice(-limit)
    .reverse()
    .map((entry) => ({ ...entry, total: usageTotal(entry) }))
}

/** 清空台账；面板给一个「清空记录」入口 */
export const clearUsageEntries = async (): Promise<void> => {
  await (await getDB()).clear(STORE)
}
