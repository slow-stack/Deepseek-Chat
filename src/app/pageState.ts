import { create } from 'zustand'

/**
 * 主区域现在显示什么：对话，或者某个插件页。
 * 插件页按 id 记，插件被关掉时由 App 退回对话。
 */
export type AppPage = 'chat' | string

export const useAppPage = create<{ page: AppPage }>(() => ({ page: 'chat' }))

export const openPage = (page: AppPage) => useAppPage.setState({ page })

/** 回到对话：选会话、开新对话、关掉正在看的插件都走这里 */
export const openChatPage = () => useAppPage.setState({ page: 'chat' })