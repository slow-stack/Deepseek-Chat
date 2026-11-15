/** 记忆库里的一条记忆；本地库与远端服务用同一个形状，界面只认这一份 */
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
