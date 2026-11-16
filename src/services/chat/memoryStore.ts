import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { MemoryPage, MemoryQuery, MemoryRecord } from './memoryTypes.js'
import type { TokenUsageEntry } from './tokenLedger.js'

/**
 * 应用自带的本地记忆库。
 *
 * 记忆不该要求用户先去跑一个服务——装上就该能用。所以默认就把记忆存在本机
 * 这个 IndexedDB 里：跟着应用一起长大、离线可用、不经过任何第三方。
 * 想连到电脑上那台记忆服务（mneme）是可选的高级用法，走 memoryRead / memory 里的远端分支。
 *
 * 用独立库名而不是塞进 chat-demo：会话库有自己的版本号与升级逻辑，
 * 混进去会让两边的 schema 版本互相牵着走。
 */
const DB_NAME = 'chat-demo-memory'
const STORE = 'memories'
/** 向量单独放一张表：改模型时整表按 model 字段作废，不用碰记忆本体 */
const VECTOR_STORE = 'vectors'
/** token 台账同库；版本号由这一处统一管，别的模块不许自己 openDB（见下方 getMemoryDB 注释） */
const USAGE_STORE = 'usage'
const DB_VERSION = 3

/** 存进库里的形态：与界面用的 MemoryRecord 一致，另存一个毫秒数便于按时间排序 */
type StoredMemory = MemoryRecord & { at: number }

/** 一条记忆的向量；model 参与比对，换模型后旧向量不可混用 */
export type StoredVector = { id: string; model: string; vector: number[] }

interface MemoryDB extends DBSchema {
  memories: { key: string; value: StoredMemory; indexes: { at: number } }
  vectors: { key: string; value: StoredVector; indexes: { model: string } }
  usage: { key: string; value: TokenUsageEntry; indexes: { at: number } }
}

let dbPromise: Promise<IDBPDatabase<MemoryDB>> | null = null

/**
 * 这个库只能从这里打开。
 *
 * IndexedDB 的版本号是库级别的：同一个库被两个模块用不同版本打开，
 * 低版本那次会直接抛 VersionError；高版本那次升级又会把对方的连接关掉，
 * 之后任何 transaction 都报 InvalidStateError。0.2.3 的记忆页读不到数据就是这么来的
 * （tokenLedger 用 v3、memoryStore 用 v2，抢同一个库）。
 *
 * 所以版本号、升级逻辑、连接生命周期全部收在这里，其他模块只调这里导出的函数。
 */
export const getMemoryDB = (): Promise<IDBPDatabase<MemoryDB>> =>
  (dbPromise ??= openDB<MemoryDB>(DB_NAME, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
        store.createIndex('at', 'at')
      }
      // 版本 2 才有向量表；老库升级时补上，已有记忆原封不动
      if (oldVersion < 2 && !db.objectStoreNames.contains(VECTOR_STORE)) {
        const store = db.createObjectStore(VECTOR_STORE, { keyPath: 'id' })
        store.createIndex('model', 'model')
      }
      // 版本 3 才有 token 台账表；从 v1/v2 上来只补 usage，memories / vectors 不动
      if (oldVersion < 3 && !db.objectStoreNames.contains(USAGE_STORE)) {
        const store = db.createObjectStore(USAGE_STORE, { keyPath: 'id' })
        store.createIndex('at', 'at')
      }
    },
  }).catch((error: unknown) => {
    dbPromise = null
    throw error
  }))

const toRecord = (stored: StoredMemory): MemoryRecord => {
  const record: MemoryRecord & { at?: number } = { ...stored }
  delete record.at
  return record
}

export type LocalMemoryInput = {
  /** 主键；不给就用 title。整理出来的条目要覆盖同一条会话的旧结果，所以单独给 id */
  id?: string
  title: string
  content: string
  occurredAt?: string | null
  type?: string
  tags?: string[]
  importance?: number | null
  /** 归属项目；不给就是全局记忆 */
  projectId?: string | null
}

const timeOf = (value: string | null | undefined): number => {
  if (!value) {
    return Date.now()
  }
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : Date.now()
}

/** 写一条；同一个 id（默认取 title）覆盖写。 */
export const saveLocalMemory = async (input: LocalMemoryInput): Promise<void> => {
  const db = await getMemoryDB()
  const id = input.id ?? input.title
  const existing = await db.get(STORE, id)
  const now = new Date().toISOString()
  const record: StoredMemory = {
    id,
    type: input.type ?? 'conversation',
    title: input.title,
    content: input.content,
    tags: input.tags ?? [],
    importance: input.importance ?? null,
    source: existing?.source ?? 'chat',
    createdAt: existing?.createdAt ?? now,
    occurredAt: input.occurredAt ?? existing?.occurredAt ?? now,
    score: null,
    at: timeOf(input.occurredAt ?? existing?.occurredAt),
    // 归属跟着写入方给的来；没给就沿用旧的（整理同一条会话时不会把项目归属洗掉）
    projectId: input.projectId !== undefined ? input.projectId : (existing?.projectId ?? null),
  }
  await db.put(STORE, record)
}

/** 本地库不大，一次游标扫完比维护倒排索引省事，也不会出现索引与内容不一致 */
const matches = (record: MemoryRecord, needle: string): boolean =>
  record.title.toLowerCase().includes(needle) ||
  record.content.toLowerCase().includes(needle) ||
  record.tags.some((tag) => tag.toLowerCase().includes(needle))

/**
 * 归属筛选：`undefined` 不过滤（全部），`null` 只留全局的，字符串只留那个项目的。
 * 老记录没有 projectId 字段，读出来当全局处理。
 * includeGlobal 为真时，除了那个项目的，也把全局的算进来。
 */
const inScope = (
  record: MemoryRecord,
  projectId: string | null | undefined,
  includeGlobal = false
): boolean => {
  if (projectId === undefined) {
    return true
  }
  const own = record.projectId ?? null
  if (own === projectId) {
    return true
  }
  return includeGlobal && own === null
}

/** 按归属取一批原始记录（带 at，计数要用）；顺序与列表一致，新的在前 */
const scopedStored = async (
  projectId: string | null | undefined,
  includeGlobal = false
): Promise<StoredMemory[]> => {
  const all = (await (await getMemoryDB()).getAllFromIndex(STORE, 'at')).reverse()
  return all.filter((record) => inScope(record, projectId, includeGlobal))
}

export const listLocalMemories = async (query: MemoryQuery = {}): Promise<MemoryPage> => {
  const keyword = query.query?.trim().toLowerCase() ?? ''
  const limit = query.limit ?? 20
  const offset = query.offset ?? 0
  const scoped = (await scopedStored(query.projectId, query.includeGlobal)).map(toRecord)
  if (!keyword) {
    return { items: scoped.slice(offset, offset + limit), total: scoped.length, mode: 'list' }
  }
  const hits = scoped.filter((record) => matches(record, keyword))
  return { items: hits.slice(offset, offset + limit), total: hits.length, mode: 'search' }
}

/** 数条数；给了 projectId 就只数那一栏的（记忆页每个栏头都要显示自己的数） */
export const countLocalMemories = async (projectId?: string | null): Promise<number> => {
  if (projectId === undefined) {
    return (await getMemoryDB()).count(STORE)
  }
  return (await scopedStored(projectId)).length
}

/** 按类型数条数：统计行要区分「对话原文」与「沉淀」 */
export const countLocalMemoriesByType = async (
  type: string,
  projectId?: string | null
): Promise<number> => {
  const all = await scopedStored(projectId)
  return all.filter((record) => record.type === type).length
}

/** 从某个时间点之后新增的条数，按写入顺序看 */
export const countLocalMemoriesSince = async (
  since: number,
  projectId?: string | null
): Promise<number> => {
  const all = await scopedStored(projectId)
  return all.filter((record) => record.at >= since).length
}

export const deleteLocalMemory = async (id: string): Promise<void> => {
  const db = await getMemoryDB()
  await db.delete(STORE, id)
  // 向量跟着记忆走，别留孤儿
  await db.delete(VECTOR_STORE, id)
}

/** 写一条记忆的向量；同一个 id 覆盖写 */
export const saveLocalVector = async (vector: StoredVector): Promise<void> => {
  await (await getMemoryDB()).put(VECTOR_STORE, vector)
}

/** 读一批记忆的向量，只认当前模型算出来的那些 */
export const loadLocalVectors = async (model: string): Promise<StoredVector[]> =>
  (await (await getMemoryDB()).getAllFromIndex(VECTOR_STORE, 'model')).filter(
    (item) => item.model === model
  )

/** 换模型时清空旧向量：新旧向量不同源，混着算距离会出垃圾结果 */
export const clearLocalVectors = async (): Promise<void> => {
  await (await getMemoryDB()).clear(VECTOR_STORE)
}

export const countLocalVectors = async (): Promise<number> => (await getMemoryDB()).count(VECTOR_STORE)

/** 导出全部记忆；换手机、换浏览器时靠它带走 */
export const exportLocalMemories = async (): Promise<MemoryRecord[]> =>
  (await (await getMemoryDB()).getAllFromIndex(STORE, 'at')).reverse().map(toRecord)
