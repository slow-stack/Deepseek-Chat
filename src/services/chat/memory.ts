import type { Session } from './types.js'

/**
 * 会话级记忆闸门（2026-11-15 桉桉要的 Chatbox 式开关）。
 *
 * 语义：会话上 `memoryEnabled === false` 时，这条会话
 *   - 不写入记忆库（蒸馏、笔记、任何入库路径都得先问这里）；
 *   - 不从记忆库取上下文（检索结果不该拼进它的 prompt）。
 * 关掉的会话照常聊天，只是与记忆系统彻底无关。
 *
 * 约定：**所有**碰记忆库的代码都从这里过，不要直接读 `session.memoryEnabled`。
 * 现在 chat 侧还没有记忆通道（没有写入方也没有读取方），所以这里是先立闸门：
 * 将来接 mneme 时，写入方与读取方各调一次，闸门才真正挡住东西。
 */
export const isMemoryEnabled = (session: Pick<Session, 'memoryEnabled'> | undefined): boolean =>
  session?.memoryEnabled !== false

/** 写库前调用；返回 false 时必须整段跳过入库，不能当成「降权写入」。 */
export const canWriteMemory = (session: Pick<Session, 'memoryEnabled'> | undefined): boolean =>
  isMemoryEnabled(session)

/** 取记忆上下文前调用；返回 false 时不要请求记忆库，也不要拼接检索结果。 */
export const canReadMemory = (session: Pick<Session, 'memoryEnabled'> | undefined): boolean =>
  isMemoryEnabled(session)