import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { MemoryPage, MemoryQuery, MemoryRecord } from './memoryTypes.js'

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

/** 存进库里的形态：与界面用的 MemoryRecord 一致，另存一个毫秒数便于按时间排序 */
type StoredMemory = MemoryRecord & { at: number }

interface MemoryDB extends DBSchema {
  memories: { key: string; value: StoredMemory; indexes: { at: number } }
}

let dbPromise: Promise<IDBPDatabase<MemoryDB>> | null = null

const getDB = () =>
  (dbPromise ??= openDB<MemoryDB>(DB_NAME, 1, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'id' })
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
  /** 唯一键：同一轮对话重复保存只覆盖，不会堆重复 */
  title: string
  content: string
  occurredAt?: string | null
  type?: string
  tags?: string[]
  importance?: number | null
}

const timeOf = (value: string | null | undefined): number => {
  if (!value) {
    return Date.now()
  }
  const time = new Date(value).getTime()
  return Number.isFinite(time) ? time : Date.now()
}

/** 写一条；同一个 title 覆盖写。 */
export const saveLocalMemory = async (input: LocalMemoryInput): Promise<void> => {
  const db = await getDB()
  const existing = await db.get(STORE, input.title)
  const now = new Date().toISOString()
  const record: StoredMemory = {
    id: input.title,
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
  }
  await db.put(STORE, record)
}

/** 本地库不大，一次游标扫完比维护倒排索引省事，也不会出现索引与内容不一致 */
const matches = (record: MemoryRecord, needle: string): boolean =>
  record.title.toLowerCase().includes(needle) ||
  record.content.toLowerCase().includes(needle) ||
  record.tags.some((tag) => tag.toLowerCase().includes(needle))

export const listLocalMemories = async (query: MemoryQuery = {}): Promise<MemoryPage> => {
  const db = await getDB()
  const keyword = query.query?.trim().toLowerCase() ?? ''
  const limit = query.limit ?? 20
  const offset = query.offset ?? 0
  const all = (await db.getAllFromIndex(STORE, 'at')).reverse().map(toRecord)
  if (!keyword) {
    return { items: all.slice(offset, offset + limit), total: all.length, mode: 'list' }
  }
  const hits = all.filter((record) => matches(record, keyword))
  return { items: hits.slice(offset, offset + limit), total: hits.length, mode: 'search' }
}

export const countLocalMemories = async (): Promise<number> => (await getDB()).count(STORE)

export const deleteLocalMemory = async (id: string): Promise<void> => {
  await (await getDB()).delete(STORE, id)
}

/** 导出全部记忆；换手机、换浏览器时靠它带走 */
export const exportLocalMemories = async (): Promise<MemoryRecord[]> =>
  (await (await getDB()).getAllFromIndex(STORE, 'at')).reverse().map(toRecord)
