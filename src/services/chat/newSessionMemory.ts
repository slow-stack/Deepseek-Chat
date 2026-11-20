import { create } from 'zustand'

/**
 * 新对话的「记忆意愿」，在会话真正落库之前先存在这里。
 *
 * 为什么需要它：会话是发出第一条消息时才创建的（`store.ts` 的 `sendMessage`），
 * 在那之前没有 id，`setMemoryEnabled(id, ...)` 无从下手。但恰恰是第一条消息
 * 最需要这个开关——以前新对话不显示开关，等于默认把开头的对话送进记忆库。
 *
 * 语义：这是**临时意愿**，不是会话状态。创建会话时读走它并写进 `Session.memoryEnabled`，
 * 写进会话之后再以会话上的字段为准；读走即复位，下一个新对话回到默认。
 */
type NewSessionMemory = { enabled: boolean }

/** 默认开：跟已有会话的语义一致（`undefined` 视为开），只是现在看得见、改得动。 */
export const useNewSessionMemory = create<NewSessionMemory>(() => ({ enabled: true }))

export const setNewSessionMemoryEnabled = (enabled: boolean) =>
  useNewSessionMemory.setState({ enabled })

/** 创建会话时取走意愿并复位，避免一次「关」粘到之后每一个新对话上。 */
export const takeNewSessionMemoryEnabled = (): boolean => {
  const { enabled } = useNewSessionMemory.getState()
  useNewSessionMemory.setState({ enabled: true })
  return enabled
}
