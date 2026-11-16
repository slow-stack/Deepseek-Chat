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
  /**
   * 这条记忆属于哪个项目；null / undefined 表示全局记忆。
   * 归属跟着来源会话走：会话在项目里，它产生的记忆也归那个项目。
   */
  projectId?: string | null
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
  /**
   * 只看某个项目的记忆；`null` 只看全局（不属于任何项目的）；
   * 不传就是全部——记忆页的「全部」那一栏走这条。
   */
  projectId?: string | null
  /**
   * 配合 projectId 用：除了这个项目的，也把全局记忆算进来。
   * 会话取上下文走这条——项目里的会话应该既知道项目里的事，也知道关于这个人本身的事，
   * 但不该读到别的项目。
   */
  includeGlobal?: boolean
}
