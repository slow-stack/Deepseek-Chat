import { create } from 'zustand'

/** 记忆面板：侧边栏底部的「记忆」入口打开 */
export const useMemoryPanel = create(() => ({ open: false }))

export const openMemoryPanel = () => useMemoryPanel.setState({ open: true })
export const closeMemoryPanel = () => useMemoryPanel.setState({ open: false })